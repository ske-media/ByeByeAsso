# Rapport de phase 9 — Opérations : tableaux de bord, tâches, notifications, rapports, exports

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-9-plan.md`.

## 1. Périmètre livré

**Tableaux de bord** calculés uniquement sur les enregistrements autoritaires — jamais de table d'agrégats, jamais de valeur inventée : vue d'ensemble de l'organisation (écran 03 enrichi : événements publiés, billets vendus / utilisés, commandes payées, brut billetterie, remboursements, adhérents actifs, bénévoles et couverture, tâches en retard, équipe) et bloc « Chiffres » sur le pilotage d'événement (remplissage, brut, remboursements, net estimé, répartition par tarif, contrôles d'accès, couverture bénévole de la version publiée avec créneaux non pourvus, commandes attribuées aux campagnes). Chaque montant porte sa **source** (grand livre en partie double, remboursements effectifs) et le net organisateur est étiqueté **estimation** (hors frais du prestataire de paiement et versements). **Finances** (écran 22) : soldes du grand livre, détail par événement, journal des écritures (D/C), documents financiers (table existante, aucune émission encore — dit tel quel), mention explicite que les **versements** dépendent du prestataire et ne sont pas simulés. **Tâches** : tâches d'organisation (titre, description, priorité, échéance, responsable, événement lié, à faire / en cours / terminée), filtres (ouvertes, mes tâches, en retard, terminées, toutes), création / modification (jeton de version) / terminer / rouvrir / suppression, tâches **système** idempotentes, page `/taches` et bloc sur le pilotage d'événement. **Notifications internes** : premier **consommateur de l'outbox** (file `domain.events`), routage par type vers les membres portant la permission pertinente au bon périmètre, idempotence par clé de déduplication, préférences par type, cloche avec compteur de non-lues, page « Notifications ». **Rapports et exports** CSV audités : journal financier, rapport d'événement, tâches. **Correction d'un défaut latent** : le relais outbox publiait vers des files `event.<type>` jamais déclarées — toutes les lignes finissaient `failed` depuis la phase 0 ; file unique `domain.events` + reprise horaire bornée des lignes échouées.

Hors périmètre, comme cadré : versements réels et rapprochement bancaire, export comptable normalisé (FEC), notifications par e-mail / push, graphiques temps réel, analytics multi-organisations.

## 2. Fichiers créés ou modifiés

- Base : `packages/database/src/schema/operations.ts` (`tasks`, `notifications`, `notification_preferences`), `schema/infrastructure.ts` (`outbox_events.requeue_count`), `schema/index.ts`, migration `0009_operations.sql`.
- Domaine : `packages/domain/src/analytics/{dashboards.ts, dashboards.test.ts, index.ts}` ; `tasks/{schemas.ts, schemas.test.ts, tasks.ts, index.ts}` ; `notifications/{notifications.ts, handlers.ts, handlers.test.ts, index.ts}` (nouveau module, export `./notifications` dans `package.json`).
- Worker : `apps/worker/src/jobs/outbox-relay.ts` (file `domain.events`, `requeueFailedOutbox`, job `outbox.requeue-failed`), `jobs/domain-events.ts` (consommateur), `queue.ts` (files), `main.ts`.
- Web — API : `analytics/organization`, `analytics/events/[eventId]`, `finances`, `finances/export`, `events/[eventId]/report/export`, `tasks` (+ `export`, `[taskId]`, `[taskId]/[action]`), `notifications` (+ `read`), `notification-preferences`.
- Web — UI : `actions/operations.ts`, `lib/tasks.ts`, `o/[slug]/page.tsx` (écran 03), `o/[slug]/finances/page.tsx` (écran 22), `o/[slug]/taches/{page.tsx, tasks-panel.tsx, labels.ts}`, `o/[slug]/notifications/{page.tsx, notifications-panel.tsx}`, `o/[slug]/evenements/[eventSlug]/page.tsx` (blocs « Chiffres » et « Tâches »), `o/[slug]/org-shell.tsx` + `layout.tsx` (nav Finances / Tâches, cloche), `packages/config/src/constants.ts` (slugs réservés `finances`, `taches`, `notifications`).
- Tests : `tests/integration/operations/operations.test.ts` (18), `tests/security/tenant-isolation.test.ts` (S11, 3), `tests/e2e/operations.e2e.ts` (4 × 2 viewports), unitaires ci-dessus (6).
- Outils : `scripts/test-server.sh` (arrêt fiable du worker : les anciens processus `tsx` survivaient au `stop` et relayaient avec l'ancien code).
- Docs : `docs/phase-9-plan.md`, `docs/openapi.yaml` 0.9.0 (131 chemins, 107 schémas), `docs/er-diagram.md`, `docs/architecture.md` (§7 worker, §7decies), captures `docs/captures/phase9-*` (1440 / 390).

## 3. Migrations

`0009_operations` : enums `task_status`, `task_priority`, `task_source` ; tables `tasks` (FK composites responsable / événement `SET NULL`, `UNIQUE (organization_id, source_key) WHERE source_key IS NOT NULL`, `CHECK done ⇔ completed_at`, `version`), `notifications` (`UNIQUE (organization_id, user_id, dedupe_key)`, index partiel non-lues, format de `kind`), `notification_preferences` (`UNIQUE (organization_id, user_id, kind)`) ; `outbox_events.requeue_count` (`CHECK >= 0`). Appliquée sur `kroov` et `kroov_test` ; base vierge 0000 → 0009 = 93 relations (92 tables + 1 vue), `db:check` sans dérive ; bundle Supabase régénéré (`.tmp/supabase/0009_operations.sql`) et rejoué sur une base neuve (10 migrations).

## 4. API livrée

| Méthode              | Chemin                                                              | Permission                                     |
| -------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| GET                  | `/organizations/{id}/analytics/organization?from&to`                | `analytics.read`                               |
| GET                  | `/organizations/{id}/analytics/events/{eventId}`                    | `analytics.read` ou `events.read` (événement)  |
| GET                  | `/organizations/{id}/finances?limit`                                | `analytics.read`                               |
| GET                  | `/organizations/{id}/finances/export`                               | `analytics.read` (CSV, audité)                 |
| GET                  | `/organizations/{id}/events/{eventId}/report/export`                | idem tableau de bord événement (CSV, audité)   |
| GET / POST           | `/organizations/{id}/tasks`                                         | `organization.read` / `tasks.manage`           |
| GET                  | `/organizations/{id}/tasks/export`                                  | `organization.read` (CSV, audité)              |
| GET / PATCH / DELETE | `/organizations/{id}/tasks/{taskId}`                                | lecture / `tasks.manage` (409 `stale_version`) |
| POST                 | `/organizations/{id}/tasks/{taskId}/{complete\|reopen}`             | `tasks.manage`                                 |
| GET                  | `/organizations/{id}/notifications?unread&limit`                    | membre actif (ses lignes seulement)            |
| POST                 | `/organizations/{id}/notifications/read` `{ ids } \| { all: true }` | membre actif (borné à ses lignes)              |
| GET / PUT            | `/organizations/{id}/notification-preferences`                      | membre actif                                   |

## 5. Routes UI livrées

`/o/[slug]` (écran 03 : KPI réels, tâches en retard, notifications non lues, raccourcis), `/o/[slug]/finances` (écran 22), `/o/[slug]/evenements/[eventSlug]` (blocs « Chiffres » + rapport CSV, « Tâches »), `/o/[slug]/taches` (filtres, dialogues création / édition, terminer / rouvrir, suppression confirmée, export), `/o/[slug]/notifications` (fil, marquage lu, préférences), cloche dans la barre supérieure. 198 routes construites.

## 6. Commandes exécutées et résultats réels

| Commande                               | Résultat                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                            | ✅ 0 erreur, 0 avertissement                                                                                                                                                    |
| `pnpm typecheck`                       | ✅ 14/14                                                                                                                                                                        |
| `pnpm db:check`                        | ✅ aucune dérive                                                                                                                                                                |
| `db:reset` (base vierge)               | ✅ 0000 → 0009, 93 relations                                                                                                                                                    |
| `pnpm test:unit`                       | ✅ 68/68 (6 nouveaux : signes du grand livre, routage des événements, schémas de tâche)                                                                                         |
| `pnpm test:integration`                | ✅ 141/141 (18 opérations : chiffres exacts après commande payée + scan + remboursement + adhésion + planning publié, finances, exports, tâches, consommateur, relais, requeue) |
| `pnpm test:security` (statique / live) | ✅ 1 + 45/45 (S11 : 3)                                                                                                                                                          |
| `node scripts/scan-secrets.mjs`        | ✅ 590 fichiers, 0 trouvaille                                                                                                                                                   |
| `pnpm --filter @kroov/web build`       | ✅ 198 routes                                                                                                                                                                   |
| `pnpm test:e2e`                        | ✅ voir §11 (suite complète, 2 viewports ; opérations 8/8 avec envoi réel par le worker)                                                                                        |
| Démarrage du worker                    | ✅ `domain.events`, `outbox.requeue-failed` déclarées ; notification livrée en < 60 s dans le parcours E2E                                                                      |
| Bundle Supabase rejoué sur base neuve  | ✅ 10 migrations, 93 relations                                                                                                                                                  |
| Connecteur Supabase (MCP)              | ⏳ toujours lié au mauvais projet et « Database is possibly not accessible » (§8)                                                                                               |

## 7. Décisions prises pendant la phase

- **Pas d'agrégats stockés** : chaque métrique est une requête sur les sources de vérité ; le coût est accepté (une organisation, quelques requêtes) et évite toute dérive de compteurs.
- **Net organisateur = brut net des remboursements** (frais acheteur exclus, car portés par l'acheteur au-dessus du prix), étiqueté estimation ; **versements non simulés**.
- **Journal CSV en colonnes sens (D/C) + montant positif** : un montant négatif en tête de cellule serait neutralisé par la protection contre l'injection de formule (`'`), ce qui casserait les totaux dans un tableur. Découvert par le test d'intégration.
- **Routage des notifications dans le domaine** (`EVENT_ROUTING`, `handleDomainEvent`), le worker ne fait que consommer : testable sans pg-boss, idempotent par `dedupe_key` et `source_key`.
- **`event.published` exclut l'acteur** (lu dans l'audit) ; **`membership.activated` ne notifie que si la formule exigeait une revue** ; les autres types n'excluent personne.
- **Schémas de mise à jour explicites** (`taskUpdateSchema`, `patchText`) : Zod 4 applique les défauts sur `.partial()` et refuse `z.undefined()` dans une union de clé d'objet (« expected nonoptional ») — `optional()` sur l'union, transformations qui laissent `undefined` intact.
- **Scanner = `events.read` organisation-wide** : il peut lire le tableau de bord d'un événement, pas celui de l'organisation ni les finances (testé).
- **Reprise bornée** des lignes outbox échouées (3 fois, horaire) plutôt qu'un rejeu illimité ; les 440 lignes `failed` de la base de dev seront reprises par le job.

## 8. Limites connues

- **Base hébergée** : le connecteur Supabase MCP reste lié au projet `tgckmrkzwkjuhqaqjgvz` et répond « Database is possibly not accessible at the moment » ; le réseau sortant de cet environnement n'atteint pas `qckogywkyxlgpwrdouiu.supabase.co`. Les migrations 0000 → 0009 sont prêtes dans `.tmp/supabase/` (rejouées sur base neuve) — à coller dans l'ordre dans l'éditeur SQL, ou à appliquer via `pnpm db:migrate` avec l'URL du pooler.
- **Resend** : adaptateur livré en phase 8, vérification externe en attente (pas de réseau sortant).
- **Documents financiers** : la table existe depuis la phase 3 mais aucun document n'est émis (pas de facturation) ; l'écran le dit explicitement.
- **Notifications** : in-app seulement ; les e-mails internes et le push restent hors périmètre. Le relais outbox passe par un balayage à la minute (pas de déclenchement direct après commit) : latence ≤ 60 s.
- **Tableaux de bord** : pas de cache ; sur de très grandes organisations, les requêtes de la vue d'ensemble seront à matérialiser (hors périmètre, pas de besoin démontré).

## 9. Sécurité

Analytics et finances bornés à l'organisation (`analytics.read`, ou `events.read` limité à l'événement pour le tableau de bord d'événement) ; 404 pour un événement d'une autre organisation. Exports audités (`finances.exported`, `event_report.exported`, `tasks.exported`). Tâches : FK composites + vérification en transaction du responsable (membre actif) et de l'événement (404), `source` et `organizationId` non patchables, jeton `version`. Notifications : lecture, marquage et préférences filtrés sur `user_id` de l'appelant·e (ids étrangers → 0 mise à jour) ; `kind` validé (422). Aucune valeur financière hors grand livre / remboursements effectifs. CSV : BOM, `;`, neutralisation des formules.

## 10. Dépendances pour la phase 10 (durcissement, performance, documentation, mise en production)

Base hébergée à migrer (0000 → 0009), Resend et Stripe à vérifier en sandbox réelle, reprise des 440 lignes outbox `failed` de la base de dev par le job horaire (ou `requeueFailedOutbox` à la main), revue des index sous charge (tableaux de bord), trigger « dernier propriétaire » à décider, runbooks.

## 11. Definition of Done — phase 9

| Critère                                                  | État                                                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Le code se construit                                     | ✅ 198 routes                                                                                                                                                                        |
| Typecheck                                                | ✅ 14/14                                                                                                                                                                             |
| Lint                                                     | ✅                                                                                                                                                                                   |
| Migrations sur base vierge                               | ✅ 0000 → 0009, 93 relations, `db:check` ; bundle Supabase rejoué                                                                                                                    |
| Tests unitaires                                          | ✅ 68/68                                                                                                                                                                             |
| Tests d'intégration                                      | ✅ 141/141 (18 opérations)                                                                                                                                                           |
| Tests E2E requis                                         | ✅ 78/78 (2 viewports) : commande payée → tableau de bord → finances + export → tâche en retard créée puis terminée → remboursement → notification via le worker → lue → préférences |
| Tests d'autorisation                                     | ✅ 45/45 par API directe (S11 : analytics / finances bornés, tâches tenant-safe, notifications par membre)                                                                           |
| Dashboards from authoritative records only               | ✅ aucune table d'agrégats, chiffres vérifiés à l'euro près en intégration, sources affichées                                                                                        |
| Net organisateur honnête                                 | ✅ estimation étiquetée, versements explicitement inconnus                                                                                                                           |
| Tâches                                                   | ✅ CRUD, jeton de version, responsable / événement du tenant, tâches système idempotentes, export                                                                                    |
| Notifications                                            | ✅ consommateur d'outbox idempotent, permissions au bon périmètre, préférences, cloche, page                                                                                         |
| Défaut outbox corrigé                                    | ✅ file `domain.events`, reprise bornée, test d'intégration du relais                                                                                                                |
| Base hébergée à jour                                     | ⏳ migrations prêtes et vérifiées localement ; **Supabase injoignable depuis cet environnement** (§8)                                                                                |
| Fournisseur e-mail de production                         | ⏳ Resend : vérification externe en attente (§8)                                                                                                                                     |
| Documentation (plan, OpenAPI, ER, architecture, rapport) | ✅                                                                                                                                                                                   |
