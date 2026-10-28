# Phase 6 — Planning intelligent : cadrage

Date : 28 octobre 2026. Précède l'implémentation (§22 du prompt maître).

## 1. Périmètre

Moteur de planning par satisfaction de contraintes explicites (contraintes dures inviolables, objectifs souples en ordre lexicographique), versions de planning par événement (brouillon → génération → proposition → revue → **publication humaine** → remplacée), instantané d'entrée immuable et journal de chaque exécution (version d'algorithme, hash, poids, couverture, non pourvus, diagnostics, score, durée), réaffectation manuelle par formulaire accessible (glisser-déposer non requis : alternative formulaire), verrouillage d'affectations, régénération partielle (périmètre choisi, verrous conservés), indicateurs de couverture, **explications de conflits** par candidat et par créneau, comparaison de versions (différentiel), publication avec validation **sur les données courantes** et concurrence optimiste, notification des bénévoles (missions modifiées seulement), confirmation de mission par le bénévole, signalement d'indisponibilité (crée une demande d'arbitrage, ne supprime rien), remplacement par nouvelle version, feuille de présence. Écrans : 14, 15, 16, 40 ; nav « Planning » ; missions sur le suivi de candidature et « Mes candidatures ».

Hors périmètre : solveur externe (OR-Tools) — moteur heuristique déterministe en TypeScript, borné et documenté ; glisser-déposer (phase d'amélioration UI ultérieure, l'alternative formulaire est livrée) ; échange de missions entre bénévoles sans arbitrage ; rémunération / défraiement.

## 2. Existant réutilisé

Phase 5 intégrale : créneaux, bénévoles acceptés, disponibilités effectives (`effectiveAvailability`, `coverageOf`), éligibilité par compétence obligatoire vérifiée, vœux ordonnés, binômes réciproques, `events.volunteer_max_hours` / `volunteer_min_rest_minutes`, statuts `assigned` / `confirmed` de la machine candidature, jetons candidat, e-mails, audit, outbox, RBAC (`volunteers.schedule`, `schedules.publish`).

## 3. Changements de base (migration `0006_scheduling`)

| Table                           | Rôle                                                                                                                                                                                                                                                    | Contraintes clés                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `schedule_versions`             | version de planning d'un événement : numéro `V1…`, statut (machine §4), `based_on_version_id`, notes, créée/publiée par et le, `superseded_at`, `version` (concurrence optimiste)                                                                       | `UNIQUE (event_id, number)`, **`UNIQUE (event_id) WHERE status = 'published'`** (une seule version publiée), FK composites |
| `schedule_generation_runs`      | exécution du moteur : `algorithm_version`, **`input_snapshot` (jsonb immuable) + `input_hash`**, `weights`, statut, `covered_count`, `unfilled_count`, `diagnostics`, `score`, `solver_status`, `duration_ms`, `scope` (régénération partielle), erreur | FK composite version ; append-only                                                                                         |
| `volunteer_assignments`         | affectation d'un bénévole (candidature) à un créneau dans une version : `source` (`auto` \| `manual`), `locked`, `confirmation_status` (`pending` \| `confirmed` \| `declined`, pertinent une fois publiée), `confirmed_at`, `notified_at`              | `UNIQUE (version_id, shift_id, application_id)`, FK composites créneau / candidature / version                             |
| `volunteer_assignment_requests` | demande née après publication : `kind` (`unavailable` \| `replacement`), message du bénévole, statut `open` \| `resolved` \| `dismissed`, résolution (par/le/commentaire)                                                                               | FK composites ; une demande ouverte par affectation (`UNIQUE (assignment_id) WHERE status = 'open'`)                       |
| `volunteer_attendance`          | présence sur une affectation publiée : `present` \| `absent` \| `late` \| `excused`, horodatages, enregistrée par, note                                                                                                                                 | `UNIQUE (assignment_id)`                                                                                                   |
| `active_volunteer_commitments`  | **vue SQL** : affectations de la version publiée de chaque événement, non déclinées, avec créneau et bénévole — « engagements effectifs » distincts des candidats d'un brouillon                                                                        | vue, lecture seule                                                                                                         |

## 4. Machine à états

```
SCHEDULE VERSION
draft → generating | under_review | superseded
generating → proposed | generation_failed
generation_failed → generating | draft
proposed → under_review | generating (régénération) | superseded
under_review → published | generating | draft | superseded
published → superseded
superseded : terminal
```

Guards : `→ published` exige zéro conflit bloquant sur les données courantes, aucune autre version publiée non remplacée dans la même transaction, et un accusé explicite si des besoins restent non pourvus ; `published → superseded` uniquement par la publication d'une autre version.

Candidature : `approved → assigned` à la publication d'une version contenant la personne ; `assigned → confirmed` quand toutes ses affectations publiées sont confirmées ; `assigned`/`confirmed → approved` quand une publication la retire ; `confirmed → assigned` si une nouvelle publication modifie ses missions.

## 5. Moteur (`packages/domain/src/scheduling/engine.ts`, pur, déterministe)

Entrées : créneaux actifs (poste, requis, max, compétences obligatoires, âge minimum), bénévoles éligibles (acceptés / affectés / confirmés) avec disponibilité effective, compétences vérifiées, rang de vœu par poste, binômes réciproques, année de naissance ; règles d'événement (heures max / jour, repos minimum) ; affectations verrouillées ; poids.

Contraintes dures (jamais contournées) : 1 bénévole éligible ; 2 créneau entièrement dans la disponibilité ; 3 aucun chevauchement ni repos insuffisant entre deux affectations ; 4 compétences obligatoires satisfaites (vérifiées si requis) et âge minimum ; 5 effectif maximum du créneau ; 6 verrous conservés s'ils restent valides (sinon signalés) ; 7 heures max par jour civil (fuseau de l'événement).

Objectifs souples, lexicographiques : 1 couverture des effectifs requis ; 2 rang de vœu ; 3 plages préférées (créneau au cœur de la disponibilité plutôt qu'en bordure) ; 4 binômes réciproques sur le même créneau ; 5 équité (écart-type des heures) ; 6 compétences souhaitées.

Algorithme `kroov-greedy-ls/1` : tri des créneaux par rareté (moins de candidats éligibles d'abord), affectation gloutonne par score souple, puis recherche locale bornée (échanges à un niveau pour combler les non pourvus, améliorations de score sans dégrader la couverture), limite de temps et d'itérations ; diagnostics par créneau non pourvu (pour chaque candidat refusé : raison dure). Sortie = **brouillon** ; aucun chemin de publication automatique.

## 6. API et UI

| Méthode    | URL                                                                                                           | Permission                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| GET        | `/organizations/{id}/events/{eventId}/schedule-versions` (+ couverture)                                       | `volunteers.schedule` ou `schedules.publish`          |
| POST       | `…/schedule-versions` `{ basedOnVersionId?, notes? }`                                                         | `volunteers.schedule`                                 |
| POST       | `…/schedule-versions/{versionId}/generate` `{ scope?: { shiftIds \| positionIds }, weights? }`                | `volunteers.schedule` (exécution inline, journalisée) |
| GET        | `…/schedule-versions/{versionId}` (affectations, conflits, non pourvus, diagnostics, candidats par créneau)   | `volunteers.schedule`                                 |
| GET        | `…/schedule-versions/{versionId}/diff?against={otherId}`                                                      | `volunteers.schedule`                                 |
| POST       | `…/schedule-versions/{versionId}/assignments` `{ shiftId, applicationId, lock? }` (validation + explications) | `volunteers.schedule`                                 |
| DELETE     | `…/assignments/{assignmentId}` · POST `…/assignments/{assignmentId}/lock` \| `unlock`                         | `volunteers.schedule`                                 |
| POST       | `…/schedule-versions/{versionId}/review` · `/publish` `{ expectedVersion, acknowledgeUnfilled? }`             | `volunteers.schedule` · **`schedules.publish`**       |
| GET        | `…/schedule-runs` · `…/schedule-runs/{runId}`                                                                 | `volunteers.schedule`                                 |
| GET / POST | `…/assignment-requests` · `…/assignment-requests/{requestId}/{resolve\|dismiss}`                              | `volunteers.schedule`                                 |
| GET / PUT  | `…/attendance` · `…/attendance/{assignmentId}` `{ status, note? }`                                            | `volunteers.schedule` ou `checkins.scan`              |
| GET        | `/public/volunteer-applications/{applicationId}/missions` (`?k=`)                                             | candidat                                              |
| POST       | `/public/volunteer-applications/{applicationId}/missions/{assignmentId}/{confirm\|report-unavailable}`        | candidat                                              |

UI organisateur : `/o/[slug]/planning` (liste des événements : version publiée, couverture, demandes ouvertes), `/o/[slug]/evenements/[eventSlug]/planning` (14 proposition : indicateurs couverture / personnes / conflits, bouton « Générer une proposition », journal de l'exécution ; 15 arbitrage : grille créneaux × places avec verrou, retrait, « Affecter… » formulaire listant les candidats éligibles et les raisons d'exclusion des autres, conflits et non pourvus expliqués ; 16 validation : différentiel contre la version publiée, demandes d'arbitrage ouvertes, « Publier le planning Vn » gardé par les conflits et par l'accusé des non pourvus, présence sur la version publiée), nav « Planning ». Public : missions sur `/candidature/[applicationId]` (40 : missions publiées, confirmer, signaler une indisponibilité), rappel sur `/moi/candidatures`.

E-mails : publication (missions de la personne, en précisant ce qui change par rapport à la version précédente et la version qui fait foi), retrait d'une mission, accusé de signalement.

## 7. Sécurité

- Publication : transaction, `SELECT … FOR UPDATE` sur l'événement, `expectedVersion` (409 `stale_version` si un autre responsable a modifié la version entre-temps), revalidation complète des contraintes dures sur les données courantes (pas seulement l'instantané), index unique partiel comme filet.
- Versions publiées et remplacées **immuables** (aucune écriture d'affectation hors `draft`/`proposed`/`under_review`, garde domaine + test).
- Aucune affectation publiée hors disponibilité, en chevauchement, ou sans qualification obligatoire (invariants §7 du prompt) — vérifié avant publication et par test.
- Tenant : FK composites ; B ne voit ni versions ni affectations de A ; responsable limité à un événement ne touche que lui.
- Bénévole : ne voit que ses missions publiées (jamais le brouillon, jamais les autres bénévoles au-delà du poste), confirme ou signale via son jeton ; un signalement ne supprime rien.
- Tests négatifs : outsider 403/404 ; publication sans `schedules.publish` 403 ; publication concurrente → une seule gagne (409 pour l'autre) ; écriture sur version publiée 412 ; affectation hors disponibilité / sans compétence / chevauchante → 412 avec explication ; jeton forgé 404 ; brouillon invisible au bénévole.

## 8. Tests attendus

Unit (moteur, sans base) : couverture maximale avant préférences ; jamais de violation dure même avec poids extrêmes ; verrous conservés ; chevauchement et repos ; heures max / jour ; compétences obligatoires ; binômes réciproques favorisés sans casser la couverture ; équité ; déterminisme ; diagnostics des non pourvus ; régénération partielle. Intégration : version → génération (journal, instantané, hash) → affectation manuelle validée (explications) → verrou → régénération partielle → revue → publication (statuts candidature, notifications, version précédente remplacée, immuabilité) → confirmation / signalement / demande d'arbitrage → nouvelle version basée sur la publiée, différentiel, publication qui notifie seulement les missions modifiées → présence ; publication concurrente ; publication bloquée par un conflit apparu après la génération (disponibilité modifiée). Sécurité : §7. E2E : besoins (phase 5) → générer → arbitrer (retirer, affecter par formulaire, verrouiller) → publier V1 → bénévole voit et confirme sa mission → signale une indisponibilité → responsable crée V2, remplace, publie → bénévole notifié des changements seulement.

## 9. Hypothèses (décidées)

1. Exécution du moteur inline dans la requête (bornée : ≤ 400 bénévoles × 300 créneaux, ≤ 5 s, itérations limitées) ; journalisée comme une exécution ; un passage en file (pg-boss) est prévu si les volumes l'exigent.
2. Publication avec besoins non pourvus : autorisée uniquement avec accusé explicite (`acknowledgeUnfilled`) affiché dans l'interface comme une décision assumée ; sans accusé → 412. Les conflits bloquants interdisent toujours la publication.
3. Le repos minimum et les heures max / jour viennent des réglages de l'événement (phase 5) ; jour civil dans le fuseau de l'événement.
4. Les binômes ne sont favorisés que s'ils sont réciproques ; les préférences impossibles sont expliquées (diagnostic), jamais déclarées satisfaites.
5. Base hébergée (Supabase) : bundle `0006` régénéré ; application dès que le projet est joignable.
