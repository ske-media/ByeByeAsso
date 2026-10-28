# Rapport de phase 6 — Planning intelligent

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-6-plan.md`.

## 1. Périmètre livré

Versions de planning par événement (`V1`, `V2`…, une seule publiée), **moteur de contraintes** `kroov-greedy-ls/1` (pur, déterministe, journalisé) qui produit une **proposition** jamais auto-publiée : contraintes dures (couverture totale par la disponibilité, compétences obligatoires vérifiées quand requis, âge minimal, non-chevauchement, repos minimal, heures max par jour civil dans le fuseau de l'événement, effectif max) jamais échangées contre les critères souples (vœux de poste, adéquation horaire, binôme réciproque, équité de charge, compétence optionnelle), verrous conservés s'ils restent valides, **régénération partielle** par créneaux, explication de chaque besoin non pourvu (raisons par personne écartée), **arbitrage manuel** (retirer, affecter par formulaire avec la liste des éligibles et des exclus expliqués, verrouiller), passage en arbitrage, **différentiel entre versions** (ce qui change pour chaque bénévole), **publication humaine transactionnelle** (jeton de concurrence, revalidation sur les données actuelles, besoins non pourvus à assumer explicitement, version précédente remplacée, candidatures en `assigned`, confirmations conservées pour les missions inchangées, e-mail **uniquement** aux bénévoles dont les missions changent avec lignes NOUVEAU / RETIRÉ), immuabilité des versions publiées, côté bénévole « **Mes missions** » (version publiée seule) avec confirmation et **signalement d'indisponibilité** (ouvre une demande d'arbitrage, la mission reste jusqu'à décision humaine), traitement des demandes, **présence** (présent·e / retard / absent·e / excusé·e) sur la version publiée, vue d'ensemble « Planning » multi-événements. Écrans : 14 (proposition), 15 (arbitrage), 16 (publication), 40 (mes missions), vue d'ensemble.

Hors périmètre, comme cadré : glisser-déposer, exécution asynchrone du moteur (file pg-boss), pointage par scan (phase 8 / contrôle d'accès réutilisera `volunteer_attendance`), relances automatiques de confirmation, export PDF des plannings.

## 2. Fichiers créés ou modifiés

| Zone                | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database` | `schema/scheduling.ts` (5 tables + vue `active_volunteer_commitments`, 7 enums), migration `0006_scheduling.sql`                                                                                                                                                                                                                                                                                                                  |
| `packages/domain`   | `scheduling/` : `engine` (moteur pur + `validateAssignments`, tests unitaires), `state-machine`, `schemas`, `scheduling` (versions, exécutions, affectations, publication, missions, demandes, présence, vue d'ensemble), `emails`, `index` — 2 778 lignes                                                                                                                                                                        |
| `apps/web`          | `actions/scheduling.ts`, 16 routes `/api/v1/*`, pages organisateur `/o/[slug]/evenements/[eventSlug]/planning` (14–16 : versions, grille créneaux × affectations, formulaire d'affectation, publication, demandes, charge) et `/o/[slug]/planning` (vue d'ensemble), nav « Planning », liens depuis le pilotage et la page bénévoles de l'événement ; public `/candidature/[applicationId]` enrichi du bloc « Mes missions » (40) |
| `tests`             | unitaires `scheduling/engine.test.ts` (9 cas), intégration `scheduling/scheduling.test.ts` (8 cas), sécurité S8 (4 cas), E2E `scheduling.e2e.ts` (3 parcours × 2 viewports)                                                                                                                                                                                                                                                       |
| `docs`              | `phase-6-plan.md`, `openapi.yaml` (91 chemins, 69 schémas), `er-diagram.md`, `architecture.md` (§7septies), captures `phase6-*`                                                                                                                                                                                                                                                                                                   |

## 3. Migrations

`0006_scheduling.sql` : 5 tables (`schedule_versions`, `schedule_generation_runs`, `volunteer_assignments`, `volunteer_assignment_requests`, `volunteer_attendance`), 1 vue (`active_volunteer_commitments` : affectations de la version publiée, non déclinées, créneau actif), 7 enums, 5 index uniques (dont les partiels `schedule_versions_published_uq` — **une seule version publiée par événement** — et `volunteer_assignment_requests_open_uq` — une demande ouverte par mission), 5 index, 5 `CHECK` (numéros et jetons ≥ 1, champs de publication cohérents, empreinte SHA-256 de 64 caractères, horodatages de présence ordonnés), 15 FK dont les composites tenant-safe (version, créneau, candidature, lignée `based_on_version_id`). Appliquée sur base vierge (`db:reset` : 73 tables), `db:check` cohérent ; bundle Supabase régénéré (`.tmp/supabase/0000…0006`) et rejoué sur une base neuve : 73 tables, 7 lignes de journal.

## 4. API livrée

| Méthode    | URL                                                                                                            | Permission / accès                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET / POST | `…/events/{eventId}/schedule-versions`                                                                         | `volunteers.schedule` (POST : `basedOnVersionId?`, `notes?`)                                   |
| GET        | `…/schedule-versions/{versionId}` → `VersionDetail` (éligibles, exclus expliqués, conflits, charge, bloqueurs) | `volunteers.schedule`                                                                          |
| POST       | `…/schedule-versions/{versionId}/generate` `{ shiftIds?, weights? }`                                           | `volunteers.schedule` ; 412 `version_immutable`                                                |
| GET        | `…/schedule-versions/{versionId}/diff?against=`                                                                | `volunteers.schedule`                                                                          |
| POST       | `…/schedule-versions/{versionId}/review`                                                                       | `volunteers.schedule` ; 409 `invalid_transition`                                               |
| POST       | `…/schedule-versions/{versionId}/publish` `{ expectedVersion, acknowledgeUnfilled?, notes? }`                  | `schedules.publish` ; 409 `stale_version` · 412 `conflicts` / `unfilled` / `version_immutable` |
| POST       | `…/schedule-versions/{versionId}/assignments` `{ shiftId, applicationId, lock? }`                              | `volunteers.schedule` ; 412 avec la raison lisible                                             |
| DELETE     | `…/assignments/{assignmentId}` · POST `…/assignments/{assignmentId}/{lock\|unlock}`                            | `volunteers.schedule`                                                                          |
| GET        | `…/events/{eventId}/schedule-runs` · `…/schedule-runs/{runId}`                                                 | `volunteers.schedule` (instantané d'entrée, empreinte, diagnostics)                            |
| GET        | `…/events/{eventId}/assignment-requests?status=open\|all`                                                      | `volunteers.schedule`                                                                          |
| POST       | `…/assignment-requests/{requestId}/{resolve\|dismiss}`                                                         | `volunteers.schedule` ; la mission n'est jamais retirée d'office                               |
| PUT        | `…/events/{eventId}/attendance/{assignmentId}` `{ status, note? }`                                             | `volunteers.schedule` ou `checkins.scan` ; version publiée seule                               |
| GET        | `/public/volunteer-applications/{applicationId}/missions` (`?k=` / connecté)                                   | candidat ; 404 uniforme ; version publiée seule                                                |
| POST       | `/public/volunteer-applications/{applicationId}/missions/{assignmentId}/{confirm\|report-unavailable}`         | candidat ; 409 si une demande est déjà ouverte                                                 |

## 5. Routes UI livrées

Organisateur : `/o/[slug]/evenements/[eventSlug]/planning?version=` (indicateurs : affectations couvertes / requises, personnes affectées — **distinct**, conflits bloquants sur données actuelles, demandes d'arbitrage ; versions avec statut et couverture ; « Nouvelle version + proposition », « Version de travail à partir de la publiée », régénération complète ou des créneaux non pourvus ; grille créneaux × affectations avec origine auto / manuelle, verrou, confirmation, présence ; dialogue « Affecter… » listant les éligibles triés par vœu et les exclus avec leur raison ; non pourvus expliqués ; verrous invalides ; différentiel ; panneau de publication avec bloqueurs et case d'acceptation des besoins non pourvus ; demandes d'arbitrage ; charge par bénévole), `/o/[slug]/planning` (vue d'ensemble : version publiée / de travail, couverture, confirmations en attente, demandes). Public : bloc « Mes missions · planning Vn » sur `/candidature/[applicationId]` (confirmer, signaler une indisponibilité avec message).

## 6. Commandes exécutées et résultats réels

```
$ pnpm lint                              → exit 0   Checked 447 files. No fixes applied.
$ pnpm typecheck                         → exit 0   Tasks: 14 successful, 14 total
$ pnpm db:check                          → exit 0   Everything's fine
$ DATABASE_URL=…kroov_test pnpm db:reset → exit 0   Base réinitialisée et migrée. (0000 → 0006, 73 tables dont la vue)
$ pnpm test:unit                         → exit 0   9 fichiers · 47 tests (38 phases 0–5 + 9 moteur)
$ pnpm test:integration                  → exit 0   9 fichiers · 99 tests (91 phases 0–5 + 8 planning)
$ pnpm test:security (statique)          → exit 0   1 test, 34 ignorés sans serveur (voulu)
$ node scripts/scan-secrets.mjs          → exit 0   466 fichiers, 0 finding
$ pnpm build                             → exit 0   Next.js compilé, 143 routes ; worker OK
$ scripts/test-server.sh start           → server up (APP_ENV=test, EMAIL_PROVIDER=file, PAYMENT_PROVIDER=fake)
$ E2E_BASE_URL=… pnpm test:security      → exit 0   2 fichiers · 35 tests (31 phases 1–5 + 4 phase 6)
$ E2E_BASE_URL=… pnpm test:e2e           → exit 0   58 passed (29 desktop-1440 + 29 mobile-390)
$ timeout 25 pnpm --filter @kroov/worker dev → "worker started" (aucune file nouvelle : moteur en ligne)
$ node scripts/supabase-bundle.mjs + rejeu sur base neuve → 73 tables, 7 migrations journalisées
$ Supabase MCP list_tables               → "Database is possibly not accessible at the moment" (inchangé)
```

Cas unitaires du moteur (réellement exécutés) : couverture limitée par la disponibilité (couverture partielle = exclue), compétence obligatoire non vérifiée refusée, âge minimal, chevauchement et repos minimal, heures max par **jour civil** dans le fuseau, verrou invalide listé et non conservé, binôme réciproque placé ensemble quand le poids le justifie, régénération partielle ne touchant que le périmètre, déterminisme (même entrée → même sortie), `validateAssignments` sur données modifiées.

Cas d'intégration notables : génération V1 avec journal d'exécution (empreinte 64 caractères, instantané rejouable, `solverStatus`) ; retrait puis affectation manuelle avec exclusions expliquées (disponibilité, compétence, repos) et 412 lisible ; verrou conservé par une régénération partielle, verrou devenu invalide signalé ; publication : 403 sans `schedules.publish`, 409 `stale_version` sur jeton périmé, 412 `conflicts` quand une disponibilité est retirée **après** la proposition, 412 `unfilled` sans acceptation explicite puis succès avec `acknowledgeUnfilled`, **deux publications concurrentes : une seule aboutit** ; version publiée immuable (affectation / génération 412) ; missions côté bénévole limitées à la version publiée, confirmation, signalement → `declined` + demande ouverte (une seule), 409 au second signalement ; V2 basée sur la publiée : différentiel, publication qui remplace V1, candidature retirée repassée `approved`, confirmation conservée pour la mission inchangée, **e-mails seulement aux personnes dont les missions changent** ; présence refusée sur une version non publiée ; vue d'ensemble multi-événements.

Captures `docs/captures/phase6-*-{1440,390}.png` : arbitrage V1 (15), version publiée V2 (16), vue d'ensemble, mes missions (40).

## 7. Décisions prises pendant la phase

- **Moteur en ligne** (dans la requête, bornes : itérations et 5 s) plutôt qu'en file pg-boss : les volumes visés (dizaines de créneaux, centaines de bénévoles) tiennent largement, et l'entrée / la sortie sont journalisées à l'identique ; le port `@kroov/scheduling` (phase 0) reste disponible pour un passage asynchrone sans changer le contrat.
- **Glouton + recherche locale** plutôt qu'un solveur externe : déterministe, explicable (chaque exclusion a une raison nommée), sans dépendance native ; `solverStatus` `partial` / `infeasible` assume l'absence de garantie d'optimalité.
- **Heures max par jour civil** dans le fuseau de l'événement (et non par fenêtre glissante de 24 h) : c'est ce que lisent les organisateurs et les bénévoles.
- **Repos minimal par défaut 30 min**, heures max 10 (réglages d'événement de la phase 5), jamais contournés par l'affectation manuelle.
- **`acknowledgeUnfilled` explicite** : publier avec des besoins non pourvus est une décision assumée, tracée dans l'audit, jamais implicite.
- **Revalidation à la publication sur les données actuelles** : une proposition reste valable tant que rien n'a bougé ; sinon 412 `conflicts` avec la liste, et l'organisateur arbitre.
- **Signalement d'indisponibilité ≠ retrait** : la mission reste affectée (`declined`) jusqu'à décision humaine via une version de travail ; l'équipe garde la main sur la couverture.
- **Notifications différentielles** : un bénévole dont rien ne change ne reçoit rien ; les lignes NOUVEAU / RETIRÉ évitent les malentendus lors des remplacements.
- Dialogue d'affectation par **formulaire** (liste triée par vœu) plutôt que glisser-déposer : accessible, testable, suffisant pour le périmètre.

## 8. Limites connues

- **Base hébergée (Supabase) toujours non synchronisée** : même état qu'en phases 3–5 (connecteur lié à `tgckmrkzwkjuhqaqjgvz`, « Database is possibly not accessible », proxy sortant bloquant `*.supabase.co`). Bundle `0000…0006` prêt et vérifié localement.
- Moteur heuristique : pas de garantie d'optimum global ; pas de contrainte « au plus N missions par personne » ni de poids par bénévole (équité globale seulement).
- Pas de glisser-déposer, pas de calendrier visuel ; pas d'exécution asynchrone ni de barre de progression.
- Les engagements sur d'autres événements (vue `active_volunteer_commitments`) ne sont pris en compte que par e-mail identique au sein de l'organisation.
- E-mails de publication envoyés hors transaction, après commit (un échec d'envoi ne défait pas la publication ; `notified_at` reflète l'envoi tenté).

## 9. Sécurité

Livré : FK composites et périmètre événement sur toutes les routes (outsider 403, autre organisation 404, responsable limité 403 hors de ses événements, création de version sur un événement étranger 404 sans fuite) ; `schedules.publish` distinct de `volunteers.schedule` ; routes publiques sous jeton candidat (404 uniforme), limitées à la version publiée — une proposition n'est **jamais** visible d'un bénévole ; notes de version, demandes et diagnostics absents des réponses publiques ; contraintes dures revérifiées côté serveur à chaque affectation manuelle et à la publication ; immuabilité des versions publiées ; audit de chaque génération, affectation, verrou, publication, demande et présence. Tests négatifs : 4 par API directe (S8) + cas 403 / 409 / 412 en intégration.

## 10. Dépendances pour la phase 7 (CRM)

- `volunteer_applications` (`email`, statuts `assigned` / `confirmed`), `volunteer_assignments` et `volunteer_attendance` alimentent l'historique de participation par contact.
- Vue `active_volunteer_commitments` réutilisable pour « qui est engagé quand » à l'échelle de l'organisation.
- Les e-mails de publication passent par le port notifications existant ; aucune file nouvelle.

## 11. Definition of Done — phase 6

| Critère                                                  | État                                                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le code se construit                                     | ✅ 143 routes                                                                                                                                                                     |
| Typecheck                                                | ✅ 14/14                                                                                                                                                                          |
| Lint                                                     | ✅                                                                                                                                                                                |
| Migrations sur base vierge                               | ✅ 0000 → 0006, 73 tables, `db:check` ; bundle Supabase rejoué sur base neuve                                                                                                     |
| Tests unitaires                                          | ✅ 47/47 (9 moteur)                                                                                                                                                               |
| Tests d'intégration                                      | ✅ 99/99                                                                                                                                                                          |
| Tests E2E requis                                         | ✅ 58/58 : besoins → candidatures acceptées → V1 proposée → arbitrage (retrait, affectation expliquée, verrou) → publication → mission confirmée → indisponibilité → V2 → traitée |
| Tests d'autorisation                                     | ✅ 35/35 par API directe ; outsider, autre organisation, responsable limité, publication sans droit, proposition invisible du bénévole, version immuable                          |
| Hard constraints never violated                          | ✅ moteur, affectation manuelle et publication (revalidation) ; tests unitaires et d'intégration                                                                                  |
| Explainability (why unfilled / why excluded)             | ✅ raisons nommées par personne et par créneau, dans l'API et l'UI                                                                                                                |
| Human publication with versioning                        | ✅ versions, différentiel, jeton de concurrence, immuabilité, remplacement                                                                                                        |
| Notifications only on change                             | ✅ différentiel par bénévole, lignes NOUVEAU / RETIRÉ, confirmations conservées                                                                                                   |
| Machine à états typée                                    | ✅ version de planning (graphe documenté, transitions gardées)                                                                                                                    |
| Base hébergée à jour                                     | ⏳ migrations prêtes et vérifiées localement ; **Supabase injoignable depuis cet environnement** (§8)                                                                             |
| Documentation (plan, OpenAPI, ER, architecture, rapport) | ✅                                                                                                                                                                                |
