# Rapport de phase 1 — Identité et organisations

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-1-plan.md`.

## 1. Périmètre livré

Authentification complète (inscription, confirmation d'adresse obligatoire, connexion, déconnexion, réinitialisation sans divulgation, changement de mot de passe), profil, organisations (création, lecture, réglages, sélection de contexte), collaborateurs (invitations à rôle, acceptation, renvoi, annulation, modification des rôles, retrait), RBAC deny-by-default à périmètre organisation / événement évalué dans les services, protection du dernier propriétaire, journal d'audit, isolation tenant prouvée par API directe. Écrans du kit couverts : 01, 02, 23, 24 (partie réglages), 45, 46, 48 ; plus les variantes sans PNG (e-mail à vérifier, invitation expirée / annulée / déjà acceptée / mauvais compte, accès restreint, 404).

## 2. Fichiers créés ou modifiés

| Zone                     | Contenu                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database`      | `schema/auth.ts` (users, sessions, accounts, verifications, rate_limits), `schema/identity.ts` (user_profiles, organizations, organization_settings, organization_members, roles, permissions, role_permissions, member_role_assignments, organization_invitations, audit_logs), FK tenant sur les tables infra, migration `0001_identity.sql` (+ seed idempotent : 24 permissions, 7 rôles, matrice par défaut) |
| `packages/auth`          | `catalogue.ts` (permissions/rôles), `server.ts` (Better Auth : adaptateur Drizzle, e-mail + mot de passe, vérification, reset, sessions 14 j, rate limiting en base, hook profil) ; ne dépend plus du domaine                                                                                                                                                                                                    |
| `packages/domain`        | `authorization/` (noyau RBAC : `loadMemberContext`, `requirePermission`, `countActiveOwners`), `audit/`, `identity/` (profil), `organizations/` (schémas zod, organisations, membres, invitations)                                                                                                                                                                                                               |
| `packages/notifications` | adaptateurs `console`, `file` (tests), `smtp` (nodemailer / Mailpit), fabrique avec garde `APP_ENV`, gabarit transactionnel texte + HTML                                                                                                                                                                                                                                                                         |
| `packages/config`        | `APP_ENV` (politique) distinct de `NODE_ENV`, `EMAIL_FILE_PATH` ; tests                                                                                                                                                                                                                                                                                                                                          |
| `packages/ui`            | `Table*`, `Person`, `ConfirmDialog` / `DialogPanel` (Radix, focus piégé), drawer mobile invisible quand fermé et refermé à la navigation, `ShellLink.onClick`                                                                                                                                                                                                                                                    |
| `apps/web`               | `lib/{auth,auth-client,session,org-context,api,actions,action-state,email,labels}.ts`, `actions/{organizations,identity}.ts`, 11 routes `/api/v1/*` + `/api/auth/[...all]`, pages `(auth)/*`, `/organisations`, `/organisations/nouvelle`, `/o/[slug]` (layout + vue d'ensemble + équipe + paramètres), `/invitation/[token]`, `/moi`, accueil avec vraies entrées                                               |
| `tests`                  | intégration `identity/{organizations,invitations}.test.ts` (24 cas), sécurité `tenant-isolation.test.ts` (11 cas par API directe) + client HTTP, E2E `identity.e2e.ts` (5 parcours × 2 viewports), helpers boîte e-mail fichier                                                                                                                                                                                  |
| `docs`                   | `phase-1-plan.md`, `openapi.yaml`, `er-diagram.md` (mis à jour), `architecture.md` (mis à jour), captures `phase1-*`                                                                                                                                                                                                                                                                                             |
| CI                       | job E2E : démarre le serveur (`APP_ENV=test`, boîte fichier), lance sécurité + Playwright                                                                                                                                                                                                                                                                                                                        |

## 3. Migrations

`0001_identity.sql` : 15 tables, 5 enums, 21 index (dont 8 uniques partiels), 10 `CHECK`, 3 `ALTER … USING ::uuid` + FK sur les tables infra, seed idempotent. Appliquée sur base vierge (dev et test), `db:check` cohérent, idempotence vérifiée.

## 4. API livrée

Voir `docs/openapi.yaml`. Résumé :

| Méthode   | URL                                                            | Permission                                                   |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| GET/PATCH | `/api/v1/profiles/me`                                          | session                                                      |
| GET/POST  | `/api/v1/organizations`                                        | session                                                      |
| GET/PATCH | `/api/v1/organizations/{id}`                                   | `organization.read` (404 non-membre) / `organization.manage` |
| GET       | `/api/v1/organizations/{id}/members`                           | `organization.read`                                          |
| PUT       | `/api/v1/organizations/{id}/members/{memberId}/roles`          | `members.manage` (+ propriétaire pour `owner`)               |
| DELETE    | `/api/v1/organizations/{id}/members/{memberId}`                | `members.manage` (+ propriétaire ; 412 dernier propriétaire) |
| GET/POST  | `/api/v1/organizations/{id}/invitations`                       | `members.invite`                                             |
| DELETE    | `/api/v1/organizations/{id}/invitations/{invitationId}`        | `members.invite`                                             |
| POST      | `/api/v1/organizations/{id}/invitations/{invitationId}/resend` | `members.invite`                                             |
| GET       | `/api/v1/organizations/{id}/audit`                             | `organization.manage`                                        |
| GET       | `/api/v1/invitations/{token}`                                  | public (données minimales)                                   |
| POST      | `/api/v1/invitations/{token}/accept`                           | session, e-mail vérifié identique                            |
| *         | `/api/auth/*`                                                  | Better Auth                                                  |

Chaque mutation : vérification d'origine (403 `forbidden_origin`), validation zod (422 avec erreurs par champ en français), erreurs domaine → statut HTTP, audit dans la transaction.

## 5. Routes UI livrées

`/`, `/connexion` (?next=, retour vers la destination), `/inscription`, `/verifier-email` (renvoi sans divulgation), `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe` (lien invalide → demande d'un nouveau), `/organisations` (sélecteur, état vide), `/organisations/nouvelle`, `/o/[slug]` (vue d'ensemble honnête : équipe, invitations, rôles, démarrage), `/o/[slug]/equipe` (table, invitation, rôles par dialogue, retrait confirmé, accès restreint sinon), `/o/[slug]/parametres` (réglages + journal d'audit, accès restreint sinon), `/invitation/[token]` (toutes les branches), `/moi` (profil, mot de passe). Chaque formulaire conserve la saisie après erreur ; chargement / vide / erreur / succès / accès interdit couverts.

## 6. Commandes exécutées et résultats réels

```
$ pnpm lint                              → exit 0   Checked 218 files. No fixes applied.
$ pnpm typecheck                         → exit 0   Tasks: 14 successful, 14 total
$ pnpm db:check                          → exit 0   Everything's fine
$ drop schema … ; pnpm db:migrate        → exit 0   Migrations appliquées. (0000 + 0001 sur base vierge)
$ pnpm test:unit                         → exit 0   5 fichiers · 25 tests
$ pnpm test:integration                  → exit 0   4 fichiers · 32 tests (8 infra + 24 identité)
$ pnpm test:security (statique)          → exit 0   1 test, 11 ignorés sans serveur (voulu)
$ pnpm build                             → exit 0   Next.js compilé, 29 routes ; worker typecheck OK
$ pnpm secrets:scan                      → exit 0   226 fichiers, 0 finding
$ serveur APP_ENV=test EMAIL_PROVIDER=file → /api/v1/health 200
$ E2E_BASE_URL=… pnpm test:security      → exit 0   2 fichiers · 12 tests (isolation A→B par ids forgés, CSRF, 401, non-divulgation, invitation, dernier propriétaire)
$ E2E_BASE_URL=… pnpm test:e2e           → exit 0   18 passed (9 desktop-1440 + 9 mobile-390)
```

Vérifications manuelles via `curl` (journal de session) : inscription → refus de connexion avant vérification (`EMAIL_NOT_VERIFIED`) → lien de vérification → connexion → profil → création d'organisation 201 → id forgé 404 → origine étrangère 403 → réinitialisation : réponse identique pour adresse connue et inconnue.

Captures `docs/captures/phase1-*-{1440,390}.png` : connexion, créer une organisation, vue d'ensemble, équipe, paramètres, invitation, profil. Aucun débordement horizontal à 390 px (vérifié par script et par test E2E sur la page équipe).

## 7. Décisions prises pendant la phase

- **`APP_ENV`** (development | test | staging | production) pour les décisions de politique ; `NODE_ENV` reste au framework. Sans `APP_ENV`, `NODE_ENV=production` ⇒ production (défaut sûr). Motivation : `next build` force `NODE_ENV=production`, ce qui faisait refuser l'adaptateur e-mail console en local.
- **Noyau d'autorisation dans `@kroov/domain/authorization`** et non dans `@kroov/auth`, pour casser le cycle auth ↔ domain détecté par Turborepo. `@kroov/auth` = catalogue + Better Auth.
- **Non-membre ⇒ 404** sur la lecture d'une organisation (l'existence n'est pas divulguée), **403** sur les mutations.
- **Adaptateur e-mail `file`** (JSON lines) pour les tests E2E et sécurité, interdit en production/préproduction comme `console`.
- Tables Better Auth avec `gen_random_uuid()` en défaut (le plugin rate-limit insère sans id) et `last_request bigint` (millisecondes epoch).
- Migration `0001` régénérée une fois avant livraison (pas de migration corrective séparée : la phase n'était pas encore publiée).
- Invitations : 7 jours, jeton 256 bits base64url, SHA-256 stocké, comparaison à temps constant, 1 invitation en attente par (organisation, e-mail), renvoi = nouveau jeton.

## 8. Limites connues

- Les **périmètres par événement** sont stockés et testés (RBAC) mais non exposés dans l'UI tant que la table `events` n'existe pas (phase 2) ; `event_id` n'a pas encore de FK.
- **Transfert de propriété** : non livré (parcours dédié ultérieur). Plusieurs propriétaires sont possibles ; le dernier est protégé.
- **Rôles personnalisés** par organisation : modèle prêt (`roles.organization_id`), pas d'UI.
- **Suppression de compte / export RGPD** : phase 10 (le modèle supporte la cascade).
- **Préférences de communication** : phase 8 (marketing), page `/moi` l'annonce sans faux contrôle.
- Rate limiting Better Auth en base : désactivé uniquement quand `APP_ENV=test` (CI, enchaînements d'inscriptions) ; actif en développement, staging et production.
- `/api/v1/invitations/{token}` n'a pas de limite de débit dédiée au-delà de celle de l'hébergeur : le jeton de 256 bits rend l'énumération impraticable, mais une limite applicative sera ajoutée avec le middleware de phase 10.
- Docker Compose toujours non exécuté dans l'environnement de validation (PostgreSQL local) ; Mailpit n'a donc pas été testé, l'adaptateur SMTP est couvert uniquement par le typage.

## 9. Sécurité

Livré : sessions en base avec cookies `HttpOnly`/`SameSite=Lax` (+ `Secure` si `APP_ENV` production/staging), mots de passe scrypt (Better Auth) ≥ 10 caractères, vérification d'adresse obligatoire avant toute action, réinitialisation et renvoi de vérification sans divulgation, révocation des autres sessions au changement/reset de mot de passe, rate limiting d'auth en base, vérification d'origine sur `/api/v1` et server actions Next, RBAC deny-by-default dans les services, FK composites tenant-safe, jetons d'invitation hachés, audit en transaction, logs sans secrets. Tests négatifs : 11 par API directe + 10 en intégration (ForbiddenError / NotFoundError / PreconditionFailedError).

Points d'attention pour la suite : limite de débit applicative générique (phase 10), politique de mots de passe compromis (HIBP) à décider, journal d'audit à exposer en lecture seule aux propriétaires (fait pour `organization.manage`).

## 10. Dépendances pour la phase 2 (événements)

- Table `events` + FK `member_role_assignments.event_id` et `organization_invitations.event_id` ; sélecteur de périmètre dans l'invitation et le dialogue de rôles.
- `EventSwitcher` dans le shell, navigation « Événements » ajoutée au menu (actuellement absente car inexistante — pas de lien mort).
- Pages publiques `/[slug]/...` : vérifier la collision avec les slugs réservés (`RESERVED_SLUGS`).

## 11. Definition of Done — phase 1

| Critère                                              | État                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le code se construit                                 | ✅                                                                                                                                                          |
| Typecheck                                            | ✅ 14/14                                                                                                                                                    |
| Lint                                                 | ✅                                                                                                                                                          |
| Migrations sur base vierge                           | ✅ 0000 + 0001, idempotent, `db:check`                                                                                                                      |
| Tests d'intégration                                  | ✅ 32/32                                                                                                                                                    |
| Tests E2E requis                                     | ✅ 18/18 (desktop + mobile) : inscription, vérification, création d'organisation, invitation, acceptation, mauvais compte, dernier propriétaire, 404, reset |
| Tests d'autorisation                                 | ✅ 12/12 par API directe + cas d'intégration ; A contre toutes les ressources de B                                                                          |
| Dernier propriétaire                                 | ✅ retrait et rétrogradation refusés (412), testé API + intégration                                                                                         |
| Invitation expirée refusée                           | ✅ intégration + page dédiée                                                                                                                                |
| Récupération sans divulgation                        | ✅ sécurité + E2E                                                                                                                                           |
| États chargement / vide / erreur / succès / interdit | ✅                                                                                                                                                          |
| Routes publiques / privées                           | ✅`requireSession`, 404 non-membre, `ForbiddenState` par permission                                                                                         |
| Aucune UI de production sur état fabriqué            | ✅ vue d'ensemble construite sur les données réelles ; modules futurs annoncés sans bouton                                                                  |
| Documentation                                        | ✅ plan, rapport, OpenAPI, ER, architecture                                                                                                                 |
| Limites connues                                      | ✅ § 8                                                                                                                                                      |

**Phase 1 : acceptée. Prochaine étape : phase 2 — événements (schéma, CRUD, réglages, pages publiques, publication).**
