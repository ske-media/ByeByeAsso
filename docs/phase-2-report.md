# Rapport de phase 2 — Événements

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-2-plan.md`.

## 1. Périmètre livré

Modèle événement complet (brouillon, informations, dates en instants + fuseau, portes, lieu, capacité, visibilité, description, programme, accès, contact, lien externe), lieux réutilisables par organisation, machine à états typée avec gardes nommées, check-list de publication, concurrence optimiste (`version`, 409), annulation motivée, archivage, suppression des seuls brouillons, clôture automatique par le worker, pages publiques par lien direct (organisation et événement), périmètre « événement » enfin exposé dans l'UI pour les invitations et les rôles, tableau de bord alimenté par les données réelles. Écrans du kit couverts : 03 (réel), 04/05 (liste et création), 07 (publication), 08 (pilotage), lieux, 26 et 27 (public). Hors périmètre, comme cadré : tarifs/quotas (phase 3), bénévoles (phase 5), affiche téléversée (phase 9), formulaires personnalisés (schéma posé, usage phases 3/5).

## 2. Fichiers créés ou modifiés

| Zone                | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database` | `schema/events.ts` (event_locations, events, event_settings, stored_files, event_media, form_definitions, form_fields, form_submissions, form_answers), `schema/_shared.ts` (`lazyForeignKey` pour le cycle identity ↔ events), FK composites `(organization_id, event_id)` sur `member_role_assignments` et `organization_invitations`, migration `0002_events.sql`                                                                                                                          |
| `packages/domain`   | `kernel/time.ts` (+ tests : heure locale → instant DST-safe, formats français, traversée de minuit), `outbox/` (`emitDomainEvent`), `events/` : `schemas.ts`, `state-machine.ts`, `events.ts` (création avec slug auto, lecture scoppée, liste, modification optimiste, check-list, publication sous verrou, annulation, archivage, suppression de brouillon, clôture système), `locations.ts`, `public.ts` ; `organizations/invitations.ts` expose `eventTitle` ; `getOrganizationForMember` |
| `packages/ui`       | `EventPoster` (affiche typographique du kit, aucun décor sur le texte)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web`          | `actions/events.ts`, `lib/event-form.ts`, 9 routes `/api/v1/*` (événements, lieux, public), pages `/o/[slug]/evenements` (+ `nouveau`, `[eventSlug]`, `modifier`, `publier`), `/o/[slug]/lieux`, `/[orgSlug]`, `/[orgSlug]/[eventSlug]`, vue d'ensemble réécrite, équipe avec sélecteur de périmètre (invitation + dialogue de rôles), navigation « Événements », page d'invitation avec périmètre                                                                                            |
| `apps/worker`       | `jobs/events.ts` : file `events.complete-ended` (horaire)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tests`             | intégration `events/events.test.ts` (21 cas), unit `kernel/time.test.ts` (5), sécurité S4 (5 cas par API directe), E2E `events.e2e.ts` (4 parcours × 2 viewports), `scripts/test-server.sh`                                                                                                                                                                                                                                                                                                   |
| `docs`              | `phase-2-plan.md`, `openapi.yaml` (21 chemins), `er-diagram.md`, `architecture.md` (§6, §7, §7ter), captures `phase2-*`                                                                                                                                                                                                                                                                                                                                                                       |

## 3. Migrations

`0002_events.sql` : 9 tables, 6 enums, 10 index (dont 5 uniques), 12 `CHECK`, 20 FK dont 8 composites tenant-safe (lieu d'un événement, réglages, médias, formulaires, et surtout les attributions de rôle et invitations limitées à un événement). Appliquée sur base vierge (`db:reset` : 29 tables dans `public`), `db:check` cohérent.

## 4. API livrée

| Méthode              | URL                                                      | Permission / règle                                                                                    |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET / POST           | `/api/v1/organizations/{id}/events`                      | `events.read` (liste scoppée aux événements attribués si pas de droit organisation) / `events.create` |
| GET / PATCH / DELETE | `/api/v1/organizations/{id}/events/{eventId}`            | `events.read` (404 hors périmètre) / `events.update` + `version` (409) / brouillon seulement (412)    |
| POST                 | `/api/v1/organizations/{id}/events/{eventId}/publish`    | `events.publish` ; 412 `publication_blocked` + `details.checklist`                                    |
| POST                 | `/api/v1/organizations/{id}/events/{eventId}/cancel`     | `events.cancel` ; motif ≥ 5 caractères ; outbox `event.cancelled`                                     |
| POST                 | `/api/v1/organizations/{id}/events/{eventId}/archive`    | `events.update` ; terminal                                                                            |
| GET / POST           | `/api/v1/organizations/{id}/locations`                   | `events.read` / `events.update`                                                                       |
| PATCH / DELETE       | `/api/v1/organizations/{id}/locations/{locationId}`      | `events.update` (DELETE = archivage, les événements gardent la référence)                             |
| GET                  | `/api/v1/public/organizations/{slug}`                    | anonyme, `Cache-Control: public, max-age=60`, publiés + publics                                       |
| GET                  | `/api/v1/public/organizations/{slug}/events/{eventSlug}` | anonyme ; publié/terminé/annulé × public/lien direct ; sinon 404 ; jamais `organizationId`/`version`  |

## 5. Routes UI livrées

`/o/[slug]` (prochain événement publié, brouillons en attente, compteurs réels, démarrage si organisation neuve), `/o/[slug]/evenements` (filtres par statut, état vide, lien « Lieux »), `/o/[slug]/evenements/nouveau`, `/o/[slug]/evenements/[eventSlug]` (pilotage : affiche, indicateurs, lien public copiable quand la page est en ligne, check-list, actions selon statut et permissions), `…/modifier` (formulaire conservé après erreur, détection de modification concurrente), `…/publier` (relecture + bouton désactivé avec raison tant que la check-list n'est pas complète), `/o/[slug]/lieux`, `/[orgSlug]` (prochaines dates, « récemment »), `/[orgSlug]/[eventSlug]` (à propos, programme, accès, annulation affichée, CTA billetterie annoncé sans faux bouton). Équipe : périmètre organisation / événement dans l'invitation et le dialogue de rôles ; la page d'invitation nomme l'événement concerné. Aucun débordement horizontal à 390 px (assertion E2E sur la page de pilotage et la page publique).

## 6. Commandes exécutées et résultats réels

```
$ pnpm lint                              → exit 0   Checked 256 files. No fixes applied.
$ pnpm typecheck                         → exit 0   Tasks: 14 successful, 14 total
$ pnpm db:check                          → exit 0   Everything's fine
$ DATABASE_URL=…kroov_test pnpm db:reset → exit 0   Base réinitialisée et migrée. (0000 + 0001 + 0002, 29 tables)
$ pnpm test:unit                         → exit 0   6 fichiers · 30 tests
$ pnpm test:integration                  → exit 0   5 fichiers · 53 tests (8 infra + 24 identité + 21 événements)
$ pnpm test:security (statique)          → exit 0   1 test, 16 ignorés sans serveur (voulu)
$ pnpm secrets:scan                      → exit 0   267 fichiers, 0 finding
$ pnpm build                             → exit 0   Next.js compilé, 51 routes ; worker OK
$ scripts/test-server.sh start           → server up (APP_ENV=test, EMAIL_PROVIDER=file)
$ E2E_BASE_URL=… pnpm test:security      → exit 0   2 fichiers · 17 tests (12 phase 1 + 5 phase 2)
$ E2E_BASE_URL=… pnpm test:e2e           → exit 0   26 passed (13 desktop-1440 + 13 mobile-390)
```

Captures `docs/captures/phase2-*-{1440,390}.png` : vue d'ensemble, événements, créer, piloter, publier, lieux, public organisation, public événement.

## 7. Décisions prises pendant la phase

- **Dates** : le formulaire saisit date + heure locales dans le fuseau de l'événement ; la conversion en instant se fait côté serveur (`kernel/time.ts`, sans dépendance, DST-safe par itération sur `Intl`). La base stocke `timestamptz` + `timezone`. Une fin le lendemain est valide et affichée explicitement.
- **Coque organisateur ouverte à tout membre actif** (`getOrganizationForMember`) : un responsable limité à un événement n'a pas `organization.read` au niveau organisation et recevait un 404 sur `/o/[slug]`. La coque n'expose que la carte de l'organisation (déjà publique) ; chaque section garde sa permission. L'API `GET /organizations/{id}` reste réservée à `organization.read`.
- **Clôture automatique** : `completed` 24 h après `ends_at` par le worker (horaire, acteur `system`, audit + outbox) — le test d'intégration a révélé que l'outbox n'était pas émis ; corrigé.
- **Grilles deux colonnes** : `grid` sans `grid-cols-1` crée une colonne implicite dimensionnée au contenu maximal ; sur mobile, un lien public long débordait et masquait le bouton d'annulation (E2E mobile). Toutes les grilles de page sont maintenant explicites.
- **Lien « Lieux »** ajouté dans l'en-tête des événements : la page existait sans entrée de navigation (lien mort inverse).
- **Nom de processus** `next-server (v16.4.3)` : `scripts/test-server.sh` remplace les `pkill` à la main (un ancien serveur avait survécu et servi un build périmé pendant une itération).

## 8. Limites connues

- `suspended` n'a pas d'action : réservé à la plateforme (phase 10, back-office).
- `private` est stocké et respecté (404 public) mais non proposé dans le formulaire tant que les adhésions (phase 4) n'existent pas.
- Affiche : typographique uniquement ; `stored_files`/`event_media` posées, non alimentées (phase 9).
- `event.logistics_changed` est émis mais sans consommateur (notifications aux participants : phase 3).
- Pas de pagination sur la liste des événements (filtre + recherche ; limite 500 côté domaine) — à ajouter avec les volumes réels.
- Le worker n'est pas exécuté dans la suite de tests : `completeEndedEvents` est testé en intégration, l'enregistrement de la file l'est par typage.
- Docker Compose toujours non exécuté dans l'environnement de validation (PostgreSQL local).

## 9. Sécurité

Livré : toute lecture/mutation d'événement passe par `requirePermission` avec `eventId` ; liste scoppée ; slug public résolu dans l'organisation (`UNIQUE (organization_id, slug)`) ; brouillons/privés jamais servis (404, pas 403) ; FK composites empêchant d'attacher un lieu, un réglage, un média ou une attribution de rôle d'une autre organisation ; publication sous verrou `FOR UPDATE` ; `version` contre les écrasements ; motif d'annulation obligatoire et audité ; réponses publiques sans identifiants internes. Tests négatifs : 5 cas par API directe (A contre les événements de B par ids forgés, lieu de B refusé sur un événement de A, responsable limité à un événement, check-list / version / permission de publication, exposition publique) + cas d'intégration (ForbiddenError / NotFoundError / ConflictError / PreconditionFailedError).

## 10. Dépendances pour la phase 3 (billetterie)

- `events.capacity` borne les quotas ; `event_settings.show_remaining_capacity` est prêt.
- `form_definitions`/`form_fields`/`form_submissions`/`form_answers` posées pour les questions à la commande.
- Outbox `event.published` / `event.cancelled` / `event.logistics_changed` à consommer pour les notifications participants.
- Le CTA billetterie de la page publique est l'emplacement du tunnel (écrans 28 →).
- Stripe Connect : `organization_settings` accueillera l'identifiant de compte connecté.

## 11. Definition of Done — phase 2

| Critère                                                  | État                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Le code se construit                                     | ✅                                                                                                                           |
| Typecheck                                                | ✅ 14/14                                                                                                                     |
| Lint                                                     | ✅                                                                                                                           |
| Migrations sur base vierge                               | ✅ 0000 + 0001 + 0002, `db:check`                                                                                            |
| Tests d'intégration                                      | ✅ 53/53                                                                                                                     |
| Tests E2E requis                                         | ✅ 26/26 : création → pilotage → publication → page publique → brouillon 404 → annulation ; invitation à périmètre événement |
| Tests d'autorisation                                     | ✅ 17/17 par API directe ; B contre les événements de A ; périmètre événement                                                |
| Machine à états                                          | ✅ typée, gardes nommées, transitions interdites testées                                                                     |
| Concurrence optimiste                                    | ✅ 409 `stale_version`, rien écrasé (intégration + API)                                                                      |
| Aucun faux bouton / donnée simulée                       | ✅ CTA billetterie annoncé et inactif ; compteurs réels ; états vides honnêtes                                               |
| Documentation (plan, OpenAPI, ER, architecture, rapport) | ✅                                                                                                                           |
