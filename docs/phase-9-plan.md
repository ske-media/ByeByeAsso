# Phase 9 — Opérations : tableaux de bord, tâches, notifications, rapports, exports — cadrage

Date : 28 octobre 2026. Précède l'implémentation (§22 du prompt maître).

## 1. Périmètre

**Tableaux de bord** organisation (écran 03 enrichi) et événement (bloc « Chiffres » sur le pilotage), calculés **uniquement** sur les enregistrements autoritaires : événements publiés, billets vendus, commandes payées, brut billetterie, remboursements, frais de plateforme et **estimation** du net organisateur (grand livre en partie double), taux de remplissage, contrôles d'accès, adhésions actives, candidatures bénévoles et taux d'acceptation, couverture des créneaux et postes non pourvus (version publiée), présence, livraisons de campagnes, commandes attribuées. **Finances** (écran 22) : soldes du grand livre, détail par événement, écritures (journal), documents financiers existants, mention claire que les **versements** dépendent du prestataire (aucun chiffre inventé). **Tâches** (`tasks.manage`) : tâches d'organisation (titre, description, priorité, échéance, responsable, événement lié, statut à faire / en cours / terminée), filtres, « mes tâches », bloc sur le pilotage d'événement. **Notifications internes** : premier **consommateur de l'outbox** (worker) qui transforme les événements de domaine en notifications pour les membres concernés (candidature reçue, indisponibilité signalée, campagne terminée, commande remboursée, adhésion à examiner…), cloche avec compteur de non-lues, page « Notifications », préférences par type. **Rapports et exports** : rapport d'événement (CSV), journal financier (CSV), tâches (CSV), participants (existant). Correction d'un défaut latent découvert : le relais outbox publiait vers des files `event.<type>` inexistantes (pg-boss exige des files déclarées) → file unique `domain.events` consommée par le worker, requeue borné des lignes échouées.

Hors périmètre : versements réels et rapprochement bancaire (prestataire), export comptable normalisé (FEC), notifications par e-mail / push (préférences in-app seulement), graphiques temps réel, analytics multi-organisations.

## 2. Existant réutilisé

Grand livre (`ledger_accounts` / `ledger_transactions` / `ledger_entries`, conventions phase 3), `orders` / `tickets` / `checkins` / `refunds`, `memberships`, `volunteer_applications`, `volunteer_shifts`, `active_volunteer_commitments`, `volunteer_attendance`, `campaign_recipients` / `message_deliveries` / `orders.campaign_id`, `outbox_events` + relais, `job_executions`, RBAC (`analytics.read`, `tasks.manage`, `organization.read`), design system (`Stat`, `StatGrid`, tables, `EmptyState`).

## 3. Changements de base (migration `0009_operations`)

| Table                      | Rôle                                                                                                                                                                                                                                                              | Contraintes clés                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks`                    | tâche d'organisation : titre, description, `status` (`todo` \| `doing` \| `done`), `priority` (`low` \| `normal` \| `high`), `due_at`, `assignee_member_id`, `event_id`, `source` (`manual` \| `system`), `source_key`, `completed_at`, `completed_by`, `version` | FK composites membre / événement (`SET NULL`), `UNIQUE (organization_id, source_key) WHERE source_key IS NOT NULL` (tâches système idempotentes), `CHECK done ⇔ completed_at` |
| `notifications`            | notification interne pour un membre : `user_id`, `kind`, `title`, `body`, `href`, `dedupe_key`, `read_at`, `created_at`                                                                                                                                           | `UNIQUE (organization_id, user_id, dedupe_key)` (idempotence du consommateur), index non-lues                                                                                 |
| `notification_preferences` | par membre et type : `in_app` (défaut vrai)                                                                                                                                                                                                                       | `UNIQUE (organization_id, user_id, kind)`                                                                                                                                     |
| `outbox_events` (+)        | `requeue_count` (reprise bornée des lignes échouées)                                                                                                                                                                                                              | `CHECK requeue_count >= 0`                                                                                                                                                    |

Aucune table d'agrégats : les métriques sont des requêtes sur les sources de vérité (pas de compteurs dérivés susceptibles de dériver).

## 4. Analytics (domaine `analytics`, lecture `analytics.read`)

`organizationDashboard(db, actor, orgId, { from?, to? })` et `eventDashboard(db, actor, orgId, eventId)` renvoient des métriques typées avec, pour chaque valeur financière, sa **source** (grand livre) : brut = −solde `revenue_tickets` (crédits) ; frais = −solde `platform_fees` ; remboursements = somme des `refunds` effectifs ; net estimé = brut − frais (remboursements déjà imputés au grand livre), étiqueté « estimation : hors frais du prestataire de paiement et versements ». Événement : capacité, billets valides / utilisés, taux de remplissage, contrôles acceptés / refusés, créneaux couverts / requis sur la version publiée, non pourvus, présences, campagnes attribuées. Aucune valeur aléatoire ; une métrique sans source affiche « — » et sa raison.

## 5. Notifications (domaine `notifications`) et consommateur d'outbox

- Relais : `queue.send("domain.events", …)` (file créée par le worker) au lieu de `event.<type>` ; le payload garde `eventType`. Job `outbox.requeue-failed` (horaire) : `failed` → `pending` avec `attempts = 0`, `requeue_count + 1`, au plus 3 fois.
- Consommateur `domain.events` : table de routage `eventType → handler` ; handlers de notifications (destinataires = membres actifs ayant la permission pertinente au périmètre de l'événement) : `volunteer_application.submitted` (→ `volunteers.review`), `schedule.unavailability_reported` (→ `volunteers.schedule`), `campaign.finished` (→ `campaigns.manage`), `order.refunded` (→ `orders.refund`), `membership.activated` si la formule exigeait une revue (→ `memberships.manage`), `event.published` (→ `events.read`, hors l'acteur). Idempotent par `dedupe_key = <eventType>:<aggregateId>`. Préférence `in_app = false` → ignoré. Un échec de handler renvoie l'erreur à pg-boss (retries), jamais de doublon.
- Commandes : `listNotifications`, `unreadCount`, `markRead(ids | all)`, `getPreferences`, `setPreference`.

## 6. Tâches (domaine `tasks`, `tasks.manage` pour écrire, `organization.read` pour lire)

`listTasks` (filtres : statut, responsable = moi, événement, échéance dépassée), `createTask`, `updateTask` (jeton `version`), `completeTask` / `reopenTask`, `deleteTask`. Tâches système idempotentes par `source_key` (prévu pour les handlers d'outbox : une indisponibilité signalée crée « Remplacer X sur <créneau> » — livré dans cette phase pour `schedule.unavailability_reported`).

## 7. API et UI

Routes `/api/v1/organizations/{id}/…` : `analytics/organization?from&to`, `analytics/events/{eventId}`, `finances` (soldes + journal paginé), `finances/export` (CSV), `events/{eventId}/report/export` (CSV), `tasks` (GET/POST), `tasks/{taskId}` (PATCH/DELETE), `tasks/{taskId}/{complete|reopen}`, `tasks/export` (CSV), `notifications?unread`, `notifications/read` (POST ids | all), `notification-preferences` (GET/PUT). UI : `/o/[slug]` (écran 03 : KPI réels + tâches en retard + notifications), `/o/[slug]/finances` (écran 22), bloc « Chiffres » et « Tâches » sur `/o/[slug]/evenements/[eventSlug]`, `/o/[slug]/taches`, `/o/[slug]/notifications` (+ préférences), cloche dans la barre supérieure.

## 8. Sécurité

Analytics et finances bornés à l'organisation (`analytics.read` / `organization.read`), responsable limité à un événement : tableau de bord de son événement seulement ; tâches : FK composites, responsable = membre de l'organisation (404 sinon), événement de l'organisation ; notifications : chaque membre ne voit que les siennes (filtre `user_id`), marquage en lecture borné à ses lignes ; exports audités ; aucune valeur financière hors grand livre / remboursements effectifs.

## 9. Tests attendus

Unitaires : agrégation des métriques depuis des écritures (signes du grand livre), routage des événements vers les destinataires. Intégration : tableau de bord organisation après commande payée + remboursement partiel + adhésion + candidatures + planning publié + campagne (chiffres exacts et sources), tableau de bord événement (remplissage, contrôles, couverture), finances (soldes = écritures), tâches (CRUD, jeton, responsable étranger 404, tâche système idempotente), notifications (consommation d'un événement outbox → une notification par destinataire autorisé, idempotence, préférence désactivée, marquage lu borné), relais vers `domain.events` + requeue borné. Sécurité S11 par API directe. E2E : commande payée → tableau de bord à jour → finances → tâche créée et terminée → candidature reçue → notification visible et lue → export CSV.

## 10. Hypothèses (décidées)

- Les versements (payouts) ne sont pas simulés : l'écran Finances affiche ce que le grand livre sait et dit explicitement ce qu'il ne sait pas.
- Le net organisateur est une **estimation** (hors frais du prestataire de paiement, non connus avant le versement).
- Notifications in-app seulement ; l'e-mail reste réservé aux messages transactionnels existants.
- Tâches système créées par le consommateur d'outbox, idempotentes, jamais supprimées automatiquement (l'équipe décide).
