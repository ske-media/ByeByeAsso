# Phase 1 — Identité et organisations : cadrage

Date : 28 octobre 2026. Précède l'implémentation (exigence §22 du prompt maître).

## 1. Périmètre

Authentification (inscription, connexion, vérification d'adresse, réinitialisation sans révéler l'existence d'un compte, sessions), profil utilisateur, organisations (création, réglages, sélection de contexte), collaborateurs (invitations à rôle et périmètre, acceptation, révocation, changement de rôles, retrait), RBAC deny-by-default évalué dans les services à périmètre organisation / événement, protection du dernier propriétaire, journal d'audit, isolation tenant testée par accès direct. Écrans du kit : 01, 02, 23, 45, 46, 48.

Hors périmètre (phases suivantes) : événements (le périmètre « événement » des rôles est stocké, la FK arrive en phase 2), liens magiques participants (phase 3, avec les billets), transfert de propriété (parcours dédié, phase 9 « opérations » — la phase 1 garantit seulement qu'un propriétaire ne peut jamais disparaître), facturation SaaS (phase 9 / billing).

## 2. Existant réutilisé

`packages/auth` (catalogue permissions/rôles), `packages/database` (client, migrations, helpers de test), `packages/domain/kernel` (erreurs, Result, Actor, StateMachine), `packages/validation` (schémas, messages FR), `packages/notifications` (port e-mail, adaptateur console), `packages/ui` (shells, formulaires, états), `apps/web` (health, layout, env), `apps/worker` (outbox).

## 3. Changements de base (migration `0001_identity`)

Tables Better Auth (noms pluriels, UUID générés côté app) : `users`, `sessions`, `accounts`, `verifications`, `rate_limits`.

Tables métier :

| Table                      | Rôle                                                                                                      | Clés / contraintes                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_profiles`            | données applicatives 1:1 avec `users` : locale, fuseau, téléphone                                         | PK = `user_id` FK users (cascade)                                                                                                                                           |
| `organizations`            | tenant : nom, `slug` unique, forme juridique, pays, fuseau, statut, créateur                              | `slug` unique, `CHECK slug ~ pattern`, FK `created_by` → users                                                                                                              |
| `organization_settings`    | 1:1 : devise, locale, e-mail de contact, site                                                             | PK = `organization_id`                                                                                                                                                      |
| `organization_members`     | appartenance : statut `active`/`removed`, dates                                                           | unique partiel `(organization_id, user_id) WHERE status = 'active'` ; unique composite `(organization_id, id)` pour les FK tenant-safe                                      |
| `roles`                    | 7 rôles système (`organization_id` NULL) + extension future par organisation                              | unique partiel sur `key` global / `(organization_id, key)`                                                                                                                  |
| `permissions`              | 24 permissions atomiques                                                                                  | `key` unique                                                                                                                                                                |
| `role_permissions`         | matrice                                                                                                   | PK `(role_id, permission_id)`                                                                                                                                               |
| `member_role_assignments`  | rôle attribué à un membre, périmètre organisation (`event_id` NULL) ou événement                          | FK composite `(organization_id, member_id)` → members ; unique partiel par `(member_id, role_id)` et `(member_id, role_id, event_id)` ; `event_id` sans FK jusqu'en phase 2 |
| `organization_invitations` | e-mail, rôle, périmètre, `token_hash` (SHA-256, jamais le jeton), expiration 7 jours, statut, acceptation | FK org/rôle/inviteur ; unique partiel `(organization_id, email) WHERE status = 'pending'`                                                                                   |
| `audit_logs`               | qui / quoi / sur quoi / pourquoi, métadonnées JSON                                                        | index `(organization_id, created_at)`                                                                                                                                       |

Infra : `outbox_events.organization_id`, `job_executions.organization_id`, `feature_flags.organization_id` passent de `text` à `uuid` + FK `organizations(id)` (tables vides en phase 0, conversion sûre).

Seed (migration SQL, idempotent) : 24 permissions, 7 rôles système, matrice par défaut issue de `DEFAULT_ROLE_PERMISSIONS`.

## 4. API et parcours UI

API `/api/v1` (session cookie Better Auth, vérification d'origine sur toute mutation, erreurs JSON `{ error: { code, message, fieldErrors? } }`) :

| Méthode       | URL                                                                           | Permission                                                   |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| GET / PATCH   | `/profiles/me`                                                                | session                                                      |
| GET / POST    | `/organizations`                                                              | session (POST crée + attribue `owner`)                       |
| GET / PATCH   | `/organizations/{id}`                                                         | `organization.read` / `organization.manage`                  |
| GET           | `/organizations/{id}/members`                                                 | `organization.read`                                          |
| PUT           | `/organizations/{id}/members/{memberId}/roles`                                | `members.manage`                                             |
| DELETE        | `/organizations/{id}/members/{memberId}`                                      | `members.manage`                                             |
| GET / POST    | `/organizations/{id}/invitations`                                             | `members.invite`                                             |
| DELETE        | `/organizations/{id}/invitations/{invitationId}`                              | `members.invite`                                             |
| POST          | `/organizations/{id}/invitations/{invitationId}/resend`                       | `members.invite`                                             |
| GET           | `/invitations/{token}`                                                        | public (métadonnées minimales, pas de données org sensibles) |
| POST          | `/invitations/{token}/accept`                                                 | session, e-mail vérifié identique à l'invitation             |
| `/api/auth/*` | Better Auth (inscription, connexion, vérification, réinitialisation, session) | —                                                            |

UI : `/connexion`, `/inscription`, `/verifier-email`, `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe`, `/organisations` (choix / création), `/organisations/nouvelle`, `/o/[slug]` (vue d'ensemble honnête : équipe, prochaines étapes), `/o/[slug]/equipe`, `/o/[slug]/parametres`, `/invitation/[token]`, `/moi`. Retour vers la destination demandée après connexion (`?next=`), changement de compte possible depuis l'écran d'invitation.

## 5. Sécurité

- Sessions Better Auth en base, cookies `HttpOnly`/`SameSite=Lax`/`Secure` en production, `AUTH_SECRET` ≥ 32 caractères obligatoire hors développement.
- Mots de passe hachés par Better Auth (scrypt), longueur minimale 10.
- Réinitialisation et renvoi de vérification : réponse identique que l'adresse existe ou non.
- Rate limiting Better Auth (stockage base) sur les routes d'auth ; limite dédiée sur `/invitations/{token}` (énumération de jetons impossible : 256 bits, hachés en base).
- RBAC : `requirePermission(db, actor, permission, { organizationId, eventId? })` dans chaque service ; deny by default ; aucune permission n'est lue depuis le client.
- Isolation : toute requête filtre par `organization_id` ; les ids d'organisation proviennent de l'URL mais sont **vérifiés** contre l'appartenance de l'acteur avant toute lecture.
- Dernier propriétaire : retrait / rétrogradation refusés si cela laisse zéro propriétaire actif (vérifié dans une transaction avec verrou sur la ligne organisation).
- Invitations : jeton à usage unique, expiré après 7 jours, révocable, accepté seulement par un compte dont l'e-mail vérifié correspond ; une invitation expirée propose un renvoi par une personne habilitée.
- Audit : création d'organisation, invitation (création/révocation/acceptation), changement de rôles, retrait de membre, modification des réglages.
- Journaux sans mot de passe, jeton ni cookie (redaction pino).

## 6. Tests attendus

Unit : autorisation (deny by default, périmètre événement, propriétaire), validation des schémas, hachage de jeton d'invitation.
Intégration : création d'organisation → membre owner + rôles ; invitation → acceptation → rôles ; invitation expirée refusée ; révoquée refusée ; mauvais e-mail refusé ; changement de rôles ; retrait ; dernier propriétaire non retirable ni rétrogradable ; audit écrit ; unicité du slug.
Sécurité : utilisateur de l'organisation A contre chaque route de B par API directe avec ids forgés (lecture, membres, invitations, réglages) → 403/404 ; jeton d'invitation forgé → 404 ; mutation sans en-tête d'origine valide → 403 ; réinitialisation ne révèle pas l'existence d'un compte ; pas de secrets commités.
E2E : inscription → vérification (lien récupéré depuis Mailpit/console) → création d'organisation → invitation → acceptation par un second compte → équipe visible ; connexion avec retour vers `?next=` ; 404/403 en français.

## 7. Hypothèses non résolues

1. Vérification d'e-mail **obligatoire** avant toute action d'organisateur (choix de sécurité ; configurable).
2. Expiration des invitations : 7 jours (kit : non spécifié).
3. Longueur minimale de mot de passe : 10 caractères, pas de règles de composition (recommandation CNIL / NIST) — à confirmer.
4. Le propriétaire est unique à la création mais plusieurs propriétaires sont possibles ; le transfert de propriété reste un parcours dédié ultérieur.
5. Mailpit en local ; fournisseur de production (Resend ou SMTP) non décidé — adaptateur en place.
