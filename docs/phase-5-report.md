# Rapport de phase 5 — Bénévoles

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-5-plan.md`.

## 1. Périmètre livré

Catalogue de l'organisation (compétences avec vérification facultative, équipes, postes types avec compétences obligatoires ou souhaitées), postes activés par événement avec **créneaux** (début, fin, effectif requis et maximum, bornés à 24 h dans la fenêtre de l'événement ± 1 jour), réglages de recrutement (ouvert/fermé avec préconditions, objectif, heures max. par jour et repos minimum pour la phase 6), **questions personnalisées** sur les formulaires dynamiques existants, candidature publique sans compte en deux étapes (identité, motivation, expérience, compétences déclarées, **vœux ordonnés**, **plages disponibles / indisponibles**, **binôme par invitation réciproque**, contraintes, consentement), accusé de réception avec lien signé, suivi (statut, modification des vœux / disponibilités / binôme tant que non affectée, retrait définitif avec impact expliqué), revue par l'équipe (correspondance vœux ↔ compétences requises avec éligibilité, projection des disponibilités sur les créneaux, vérification des compétences, binôme résolu, **notes internes jamais exposées**, modification, décisions : à l'étude, acceptée, liste d'attente, non retenue avec motif), **traitement en lot avec validation par enregistrement**, **matrice de disponibilité** (bénévoles acceptés × créneaux, compteur de disponibles par créneau), filtres (événement, statut, poste, compétence, recherche), « Mes candidatures », bloc « Équipe bénévole » sur le pilotage d'événement et CTA « Je candidate » sur la page publique. Écrans : 11, 12, 13, 37, 38, 39, « Mes candidatures ».

Hors périmètre, comme cadré : versions de planning, génération, affectations, confirmation de mission, présence (phase 6 ; statuts `assigned`/`confirmed` déclarés dans la machine, jamais atteints) ; import de bénévoles, documents, mineurs avec autorisation, défraiement.

## 2. Fichiers créés ou modifiés

| Zone                | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/database` | `schema/volunteers.ts` (11 tables), `events` + 4 colonnes de réglage bénévoles (+ `CHECK`), migration `0005_volunteers.sql`                                                                                                                                                                                                                                                                                                                                                                                        |
| `packages/domain`   | `volunteers/` : `schemas`, `state-machine`, `availability` (intervalles purs), `catalogue`, `staffing`, `applications`, `emails`, `index` — 3 255 lignes ; `kernel/errors.ts` : `ValidationError` (erreurs de champs issues du domaine, remontées en 422 `fieldErrors`)                                                                                                                                                                                                                                            |
| `packages/config`   | slugs réservés `candidature(s)`, `benevole(s)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web`          | `lib/api.ts` + `lib/actions.ts` (propagation des `fieldErrors` du domaine), `actions/volunteers.ts`, 21 routes `/api/v1/*`, pages organisateur `/o/[slug]/benevoles` (11 : onglets candidatures / équipes & postes / compétences, filtres, lot), `…/benevoles/candidatures/[applicationId]` (12), `/o/[slug]/evenements/[eventSlug]/benevoles` (13 + matrice), nav « Bénévoles », bloc pilotage ; public `/[orgSlug]/[eventSlug]/benevoles` (37–38), `/candidature/[applicationId]` (39), `/moi/candidatures`, CTA |
| `tests`             | intégration `volunteers/volunteers.test.ts` (13 cas), sécurité S7 (4 cas), E2E `volunteers.e2e.ts` (4 parcours × 2 viewports)                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs`              | `phase-5-plan.md`, `openapi.yaml` (75 chemins, 56 schémas), `er-diagram.md`, `architecture.md` (§7sexies), captures `phase5-*`                                                                                                                                                                                                                                                                                                                                                                                     |

## 3. Migrations

`0005_volunteers.sql` : 11 tables, 6 enums, 18 index (uniques partiels `volunteer_applications_live_uq`, uniques de rang et de poste par candidature), 19 `CHECK` (créneaux bornés et cohérents, e-mails en minuscules, motif obligatoire au refus, réglages d'événement bornés, slugs), 21 FK dont les composites tenant-safe. Appliquée sur base vierge (`db:reset` : 67 tables), `db:check` cohérent ; bundle Supabase régénéré (`.tmp/supabase/0000…0005`) et rejoué sur une base neuve : 67 tables, 6 lignes de journal.

Consolidation documentée : les questions personnalisées réutilisent `form_definitions` / `form_fields` / `form_submissions` / `form_answers` (aucune table nouvelle) ; `active_volunteer_commitments` sera une vue des affectations publiées (phase 6).

## 4. API livrée

| Méthode        | URL                                                                                                           | Permission / accès                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| GET / POST     | `/organizations/{id}/skills`, `…/volunteer-teams`, `…/volunteer-positions`                                    | `volunteers.review`                                   |
| PATCH / DELETE | `…/skills/{skillId}`, `…/volunteer-teams/{teamId}`, `…/volunteer-positions/{positionId}` (DELETE = archivage) | `volunteers.review`                                   |
| GET / PATCH    | `…/events/{eventId}/volunteering`                                                                             | GET `volunteers.review` · PATCH `volunteers.schedule` |
| POST           | `…/events/{eventId}/volunteer-positions`                                                                      | `volunteers.schedule` (activation idempotente)        |
| PATCH / DELETE | `…/events/{eventId}/volunteer-positions/{eventPositionId}`                                                    | `volunteers.schedule` (retrait = créneaux annulés)    |
| POST           | `…/volunteer-positions/{eventPositionId}/shifts` · PATCH / DELETE `…/shifts/{shiftId}`                        | `volunteers.schedule`                                 |
| GET            | `…/events/{eventId}/volunteer-availability-matrix`                                                            | `volunteers.review`                                   |
| GET            | `/organizations/{id}/volunteer-applications?eventId&status&positionId&skillId&q` → `{ applications, stats }`  | `volunteers.review` (périmètre événement)             |
| POST           | `…/volunteer-applications/bulk`                                                                               | `volunteers.review` ; résultat par enregistrement     |
| GET / PATCH    | `…/volunteer-applications/{applicationId}`                                                                    | `volunteers.review` ; `status` jamais patchable       |
| POST           | `…/volunteer-applications/{applicationId}/{review\|approve\|waitlist\|reject}`                                | `volunteers.review` ; motif requis pour `reject`      |
| POST           | `…/volunteer-applications/{applicationId}/skills/{skillId}` `{ verified }`                                    | `volunteers.review`                                   |
| GET            | `/public/organizations/{slug}/events/{eventSlug}/volunteering`                                                | anonyme (événement publié)                            |
| POST           | `/public/organizations/{slug}/events/{eventSlug}/volunteer-applications`                                      | anonyme ou connecté ; `accessToken` renvoyé une fois  |
| GET / PATCH    | `/public/volunteer-applications/{applicationId}` (`?k=` / connecté)                                           | candidat ; 404 uniforme ; `status` et notes ignorés   |
| POST           | `/public/volunteer-applications/{applicationId}/withdraw`                                                     | candidat ; définitif                                  |

## 5. Routes UI livrées

Organisateur : `/o/[slug]/benevoles` (indicateurs : personnes acceptées / objectif, à examiner, liste d'attente, **affectations à couvrir — distinct des personnes** ; onglets candidatures / équipes & postes / compétences ; filtres ; sélection + accepter / liste d'attente / à l'étude / non retenues en lot), `/o/[slug]/benevoles/candidatures/[applicationId]`, `/o/[slug]/evenements/[eventSlug]/benevoles`. Public : `/[orgSlug]/[eventSlug]/benevoles`, `/candidature/[applicationId]` (`?k=`), `/moi/candidatures` (+ lien depuis `/moi`), CTA sur la page événement.

## 6. Commandes exécutées et résultats réels

```
$ pnpm lint                              → exit 0   Checked 415 files. No fixes applied.
$ pnpm typecheck                         → exit 0   Tasks: 14 successful, 14 total
$ pnpm db:check                          → exit 0   Everything's fine
$ DATABASE_URL=…kroov_test pnpm db:reset → exit 0   Base réinitialisée et migrée. (0000 → 0005, 67 tables)
$ pnpm test:unit                         → exit 0   8 fichiers · 38 tests
$ pnpm test:integration                  → exit 0   8 fichiers · 91 tests (78 phases 0–4 + 13 bénévoles)
$ pnpm test:security (statique)          → exit 0   1 test, 30 ignorés sans serveur (voulu)
$ node scripts/scan-secrets.mjs          → exit 0   432 fichiers, 0 finding
$ pnpm build                             → exit 0   Next.js compilé, 127 routes ; worker OK
$ scripts/test-server.sh start           → server up (APP_ENV=test, EMAIL_PROVIDER=file, PAYMENT_PROVIDER=fake)
$ E2E_BASE_URL=… pnpm test:security      → exit 0   2 fichiers · 31 tests (27 phases 1–4 + 4 phase 5)
$ E2E_BASE_URL=… pnpm test:e2e           → exit 0   52 passed (26 desktop-1440 + 26 mobile-390)
$ timeout 25 pnpm --filter @kroov/worker dev → "worker started" (aucune file nouvelle : pas de job en phase 5)
$ node scripts/supabase-bundle.mjs + rejeu sur base neuve → 67 tables, 6 migrations journalisées
```

Cas d'intégration notables (réellement exécutés) : arithmétique d'intervalles (fusion, soustraction, couverture totale / partielle / nulle, plages hors fenêtre et chevauchantes refusées) ; catalogue et isolation (B ne lit ni n'utilise le catalogue de A, compétence étrangère refusée) ; ouverture du recrutement refusée sans poste ; créneau hors fenêtre 412, fin avant début et max < requis 422 ; candidature complète avec vœux ordonnés, 10 h effectives, SST déclaré non vérifié, binôme non réciproque, réponses validées ; refus des vœux vides, plages hors fenêtre, réponse obligatoire manquante, option inconnue, poste non activé, binôme = soi-même ; doublon 409 insensible à la casse ; recrutement fermé 412 ; lecture candidat par jeton seulement ; **binôme réciproque à la seconde candidature, rompu quand l'une retire le souhait** ; revue : éligibilité fausse puis vraie après vérification du SST, notes internes absentes de la vue candidat ; décisions et e-mails ; refus sans motif 422 ; rejeté = terminal mais une nouvelle candidature est possible ; listes filtrées par statut / compétence / poste / recherche ; stats ; responsable limité à un autre événement : liste vide, 403 ailleurs ; matrice (2 disponibles sur l'ouverture, 0 sur la nuit) et créneau annulé disparu ; lot : 2 succès + 1 échec sur id inconnu ; retrait définitif, réciprocité rompue dans les deux sens ; « mes candidatures » par compte ou e-mail.

Captures `docs/captures/phase5-*-{1440,390}.png` : bénévoles (11), équipes & postes, examiner (12), postes et besoins (13), candidature (37), suivi (39).

## 7. Décisions prises pendant la phase

- **Candidature par événement** : les disponibilités n'ont de sens que pour des dates ; le vivier inter-événements viendra du CRM (phase 7, par e-mail).
- **Deux vues strictement séparées** (candidat / équipe) plutôt qu'un filtrage à la sérialisation : `internalNotes`, `reviewedBy`, résolution du binôme et projection sur les créneaux n'existent que dans `ApplicationView`.
- **Binôme non révélateur** : le candidat ne voit que l'adresse saisie et un booléen `reciprocal` (vrai seulement si l'autre l'a aussi nommé) ; test de sécurité : la vue est identique avant et après la candidature de l'autre personne quand elle ne le nomme pas. La résolution côté équipe se fait par e-mail à la lecture (pas seulement au moment de la saisie).
- **Erreurs de champs du domaine** : nouvelle `ValidationError` (code `validation_failed`, `details.fieldErrors`) remontée en 422 avec `fieldErrors` au même format que Zod, et dans les actions serveur ; toutes les erreurs d'une candidature sont collectées en une passe (vœux, plages, réponses, binôme).
- **Questions personnalisées** sur les formulaires de la phase 2 (consolidation) ; la clé est dérivée du libellé et stable, pour conserver les réponses déjà données quand l'équipe reformule.
- **Lot** : une transaction par enregistrement ; l'échec d'un id ne bloque pas les autres ; un audit global résume succès / échecs.
- **Libellés côté client** : les composants client ne peuvent pas importer `@kroov/domain/*` (le module tire le pilote PostgreSQL via Turbopack) ; copie client des libellés de statut dans `status-tone.ts`.
- « Personnes acceptées » et « affectations à couvrir » sont deux indicateurs distincts et jamais interchangés (règle du guide UX).

## 8. Limites connues

- **Base hébergée (Supabase) toujours non synchronisée** : même état qu'en phase 4 (connecteur lié à `tgckmrkzwkjuhqaqjgvz`, « Database is possibly not accessible », proxy sortant bloquant `*.supabase.co`). Bundle `0000…0005` prêt et vérifié localement.
- Compétences des postes évaluées sur le poste type ; pas de surcharge par événement (le briefing seul est spécifique).
- Pas de glisser-déposer pour ordonner les vœux (boutons monter / descendre, accessibles) ; pas de calendrier visuel pour les plages (champs date + heure).
- L'invitation binôme part une seule fois par adresse et par candidature ; aucune relance.
- Le retrait d'une candidature acceptée n'a pas encore d'« impact sur les missions » à afficher (phase 6).
- Âge minimum des postes : affiché et stocké (`birth_year`), non bloquant à la revue (sera une contrainte dure du planning en phase 6).

## 9. Sécurité

Livré : FK composites et périmètre événement sur toutes les routes (outsider 403, autre organisation 404, responsable limité 403 hors de ses événements) ; jeton candidat dérivé, jamais stocké, renvoyé une fois, 404 uniforme ; `status`, `internalNotes` et champs de revue ignorés par les routes publiques ; notes internes et métadonnées de revue absentes des réponses publiques (assertions sur le JSON) ; aucune exposition d'un autre bénévole (binôme) ; validation serveur des plages, vœux, compétences et réponses ; transitions par routes dédiées seulement, auditées avec acteur et motif ; lot validé par enregistrement. Tests négatifs : 4 par API directe (S7) + 13 en intégration.

## 10. Dépendances pour la phase 6 (planning)

- Entrées du moteur prêtes : créneaux (`volunteer_shifts` actifs, requis / max), bénévoles acceptés, disponibilités effectives (`effectiveAvailability`, `coverageOf`), compétences obligatoires vérifiées (`PreferenceView.eligible`), vœux ordonnés, binômes réciproques, `events.volunteer_max_hours` / `volunteer_min_rest_minutes`.
- Transitions `approved → assigned → confirmed` déjà dans la machine ; `volunteer_shifts.version` pour la régénération partielle.
- À créer : `schedule_versions`, `volunteer_assignments`, `schedule_generation_runs`, `volunteer_assignment_requests`, `volunteer_attendance`, vue `active_volunteer_commitments`, écrans 14–16 et 40.

## 11. Definition of Done — phase 5

| Critère                                                  | État                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le code se construit                                     | ✅ 127 routes                                                                                                                                           |
| Typecheck                                                | ✅ 14/14                                                                                                                                                |
| Lint                                                     | ✅                                                                                                                                                      |
| Migrations sur base vierge                               | ✅ 0000 → 0005, 67 tables, `db:check` ; bundle Supabase rejoué sur base neuve                                                                           |
| Tests unitaires                                          | ✅ 38/38                                                                                                                                                |
| Tests d'intégration                                      | ✅ 91/91                                                                                                                                                |
| Tests E2E requis                                         | ✅ 52/52 : catalogue → postes, créneaux, question → recrutement → candidature 2 étapes → revue, vérification, acceptation → binôme réciproque → retrait |
| Tests d'autorisation                                     | ✅ 31/31 par API directe ; outsider, autre organisation, responsable limité, jeton forgé, champs non patchables, binôme non révélateur                  |
| Candidate submission / approval / preference ordering    | ✅                                                                                                                                                      |
| Availability validation                                  | ✅ fenêtre, chevauchements, bornes, projection sur les créneaux                                                                                         |
| Mutual colleague preference                              | ✅ réciprocité calculée, rompue au retrait / refus, jamais révélatrice                                                                                  |
| Qualification validation                                 | ✅ compétence obligatoire = déclarée et vérifiée ; éligibilité par vœu                                                                                  |
| Machine à états typée                                    | ✅ candidature (graphe documenté, transitions gardées)                                                                                                  |
| Base hébergée à jour                                     | ⏳ migrations prêtes et vérifiées localement ; **Supabase injoignable depuis cet environnement** (§8)                                                   |
| Documentation (plan, OpenAPI, ER, architecture, rapport) | ✅                                                                                                                                                      |
