# Phase 2 — Événements : cadrage

Date : 28 octobre 2026. Précède l'implémentation (§22 du prompt maître).

## 1. Périmètre

Modèle événement complet (brouillon, informations, dates avec fuseau, lieu, capacité, visibilité, description, accès), lieux réutilisables par organisation, machine à états typée (draft → published → completed → archived ; published → cancelled par action dédiée ; suspended réservé à la plateforme), check-list de publication, concurrence optimiste, pages publiques par lien direct (organisation et événement), périmètre « événement » enfin exposé pour les rôles et invitations. Écrans : 03 (tableau de bord avec données réelles), 04, 05, 07, 08 (volets événement), 26/27 (public).

Hors périmètre : tarifs et quotas (phase 3, écran 06), besoins bénévoles (phase 5), téléversement d'affiche (stockage S3 — phase 9, l'affiche typographique du kit sert d'identité visuelle), formulaires personnalisés (schéma posé, usage en phases 3 et 5), marketplace global (exclu du MVP).

## 2. Existant réutilisé

RBAC (`events.*` déjà au catalogue), `StateMachine` du noyau, audit, outbox, shells et composants UI, actions/route toolkit, `loadOrgPage`.

## 3. Changements de base (migration `0002_events`)

| Table                                                                   | Rôle                                                                                                                                                                                                                                                                                             | Contraintes                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event_locations`                                                       | lieux d'une organisation (nom, adresse, ville, code postal, pays, accès/accessibilité, géoloc optionnelle)                                                                                                                                                                                       | FK organisation, `UNIQUE (organization_id, id)`                                                                                                                             |
| `events`                                                                | événement : slug (unique par organisation), titre, accroche, description, `starts_at`/`ends_at` timestamptz + `timezone`, `doors_at`, capacité, statut, visibilité (`public`/`unlisted`/`private`), `location_id`, `version` (concurrence), `published_at`, `cancelled_at` + motif, `created_by` | `UNIQUE (organization_id, slug)`, `CHECK ends_at > starts_at`, `CHECK capacity >= 0`, FK composite `(organization_id, location_id)` → lieux, `UNIQUE (organization_id, id)` |
| `event_settings`                                                        | 1:1 : infos accès/accueil, contact affiché, lien externe, `allow_waitlist` (futur), options d'affichage                                                                                                                                                                                          | PK = `event_id`                                                                                                                                                             |
| `event_media`                                                           | fichiers liés (affiche, visuels) — FK `stored_files` ; table posée, non alimentée avant le stockage (phase 9)                                                                                                                                                                                    | FK composite tenant                                                                                                                                                         |
| `stored_files`                                                          | registre des fichiers S3 (clé, type MIME, taille, hachage, visibilité) — posée, non utilisée                                                                                                                                                                                                     | FK organisation                                                                                                                                                             |
| `form_definitions`, `form_fields`, `form_submissions`, `form_answers`   | questions personnalisées rattachées à un événement ou à l'organisation ; usage phases 3 (commande) et 5 (candidature)                                                                                                                                                                            | FK tenant, `UNIQUE (form_id, key)`, `CHECK field_type IN (…)`                                                                                                               |
| `member_role_assignments.event_id`, `organization_invitations.event_id` | **FK composite** `(organization_id, event_id)` → `events (organization_id, id)`                                                                                                                                                                                                                  | aucune attribution sur un événement d'une autre organisation                                                                                                                |

Consolidations documentées : `event_location_links` (M:N) non créée — un événement a un lieu principal ; les emplacements de postes bénévoles porteront leur propre libellé en phase 5. `event_staff` non créée — déjà représentée par `member_role_assignments` à périmètre événement (phase 1).

## 4. Machine à états

```
draft → published (garde : champs requis, lieu, capacité > 0, fin > début, organisation active)
draft → archived
published → cancelled (action dédiée avec motif ; phase 3 ajoutera la revue des billets)
published → suspended (plateforme) → published
published → completed (après ends_at, par job quotidien ou à la lecture)
completed → archived ; cancelled → archived
```

Statuts terminaux : `archived`. Aucun PATCH générique ne modifie `status`.

## 5. API et UI

API (`docs/openapi.yaml` mis à jour) :

| Méthode     | URL                                               | Permission                                                                   |
| ----------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET / POST  | `/organizations/{id}/events`                      | `events.read` / `events.create`                                              |
| GET / PATCH | `/organizations/{id}/events/{eventId}`            | `events.read` / `events.update` (If-Match / `version`)                       |
| POST        | `/organizations/{id}/events/{eventId}/publish`    | `events.publish`                                                             |
| POST        | `/organizations/{id}/events/{eventId}/cancel`     | `events.cancel` (motif requis)                                               |
| POST        | `/organizations/{id}/events/{eventId}/archive`    | `events.update`                                                              |
| GET / POST  | `/organizations/{id}/locations`                   | `events.read` / `events.update`                                              |
| PATCH       | `/organizations/{id}/locations/{locationId}`      | `events.update`                                                              |
| GET         | `/public/organizations/{slug}`                    | public (événements publiés, visibilité `public`)                             |
| GET         | `/public/organizations/{slug}/events/{eventSlug}` | public (publié ; `unlisted` accessible par lien ; `private`/brouillon → 404) |

UI organisateur : `/o/[slug]` (tableau de bord : prochain événement, compteurs réels), `/o/[slug]/evenements` (liste, filtres statut, état vide), `/o/[slug]/evenements/nouveau` (05), `/o/[slug]/evenements/[eventSlug]` (08 : pilotage, lien public, check-list, actions), `/o/[slug]/evenements/[eventSlug]/modifier`, `/o/[slug]/evenements/[eventSlug]/publier` (07), `/o/[slug]/lieux`. Équipe : sélecteur de périmètre (organisation / événement) dans l'invitation et le dialogue de rôles.

Public : `/[orgSlug]` (26 : événements publiés de l'organisation) et `/[orgSlug]/[eventSlug]` (27 : page événement, onglets à propos / programme / infos, bouton billets désactivé avec raison tant que la billetterie n'existe pas — pas de faux CTA).

## 6. Sécurité

- Toute lecture/mutation passe par `requirePermission` avec `eventId` : un responsable événement limité à un événement ne voit ni ne modifie les autres.
- Slug public résolu **dans** l'organisation (`UNIQUE (organization_id, slug)`) ; collision avec `RESERVED_SLUGS` interdite au niveau organisation déjà, et les routes publiques `/[orgSlug]` passent après les routes applicatives.
- Brouillons et événements privés jamais servis publiquement (404, pas 403).
- Concurrence optimiste : `version` incrémentée à chaque modification ; une modification avec version périmée renvoie 409 `stale_version` sans écraser.
- Annulation d'un événement publié : motif obligatoire, audit, outbox `event.cancelled` (notifications en phase 3 quand il y aura des participants).

## 7. Tests attendus

Unit : machine à états (graphe, gardes), schémas (fin après début, traversée de minuit acceptée, capacité).
Intégration : création brouillon ; publication valide ; publication refusée (champs manquants, dates invalides) ; dates invalides rejetées à la création ; annulation avec motif + audit + outbox ; concurrence (version périmée → conflit, rien écrasé) ; isolation (événement de A inaccessible depuis B) ; rôle limité à un événement (lecture OK sur le sien, refus sur l'autre) ; lecture publique : brouillon 404, `unlisted` accessible par slug mais absent de la liste, `private` 404.
Sécurité (API directe) : B attaque les événements de A (lecture 404, mutations 403) ; responsable limité à l'événement X ne peut pas publier Y ; publication d'un brouillon impossible sans `events.publish`.
E2E : création → pilotage → publication → page publique visible → brouillon public 404 ; liste et filtres ; invitation à périmètre événement.

## 8. Hypothèses

1. Visibilité par défaut `public` à la publication ; `unlisted` disponible (lien direct) ; `private` (phase 4 : réservé aux adhérents) stocké mais non proposé en UI.
2. `completed` automatique 24 h après `ends_at` par le worker (job quotidien) ; pas de `ended` intermédiaire (le guide propose `ended`, le prompt maître impose `completed`).
3. Modification des dates après publication : autorisée avec confirmation ; la notification des participants arrive en phase 3.
4. Suppression définitive d'un brouillon : autorisée (hard delete) tant qu'aucune dépendance n'existe ; les événements publiés ne se suppriment jamais (annulation puis archivage).
