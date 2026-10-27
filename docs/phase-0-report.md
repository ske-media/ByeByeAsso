# Rapport de phase 0 — Fondation du dépôt

Date : 27 octobre 2026 · Environnement de validation : Linux, Node 22.23.4, pnpm 10.28.0, PostgreSQL 16.15 (instance locale ; Docker Compose fourni mais non exécutable dans l'environnement de validation).

## 1. Périmètre

Établir l'architecture (monolithe modulaire, monorepo), épingler la stack, configurer formatage / lint / typecheck / tests, préparer PostgreSQL et le worker, créer les tokens de design et le système de composants de base, fournir les modèles d'environnement, documenter, et prouver un démarrage local reproductible. **Aucune fonctionnalité métier** (identité, billetterie, planning, marketing) n'est implémentée : c'est voulu.

## 2. Fichiers créés

| Zone                                                                 | Contenu                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| racine                                                               | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `biome.json`, `vitest.config.ts`, `.npmrc`, `.gitignore`, `.env.example`, `README.md`, `.github/workflows/ci.yml`, `scripts/scan-secrets.mjs`                                                                              |
| `apps/web`                                                           | Next.js 16 : `layout.tsx` (lang fr, viewport zoomable), `page.tsx`, `not-found.tsx`, `error.tsx`, `api/v1/health/route.ts`, `design-system/` (dev uniquement), `lib/{env,db,logger}.ts`, `next.config.ts` (en-têtes de sécurité, chargement du `.env` racine)                                     |
| `apps/worker`                                                        | `main.ts` (démarrage, arrêt propre SIGINT/SIGTERM), `queue.ts` (pg-boss, files et politiques), `jobs/outbox-relay.ts`, `jobs/maintenance.ts`                                                                                                                                                      |
| `packages/config`                                                    | tsconfig de base / node / nextjs, `env.ts` (schéma zod complet + tests), `constants.ts`                                                                                                                                                                                                           |
| `packages/validation`                                                | primitives zod (uuid, e-mail, slug, devise, unités mineures, fuseau, intervalle, pagination), carte d'erreurs en français, `validate()` → erreurs par champ, tests                                                                                                                                |
| `packages/database`                                                  | client Drizzle + pool pg, schéma INFRASTRUCTURE, `drizzle.config.ts`, migration `0000_infrastructure.sql`, runner `migrate.ts`, CLI `migrate` / `reset`, helpers de test                                                                                                                          |
| `packages/domain`                                                    | noyau : `errors`, `result`, `money`, `state-machine`, `actor`, `ids` (+ tests) ; 15 modules avec frontière déclarée (`index.ts`)                                                                                                                                                                  |
| `packages/auth`                                                      | catalogue de 24 permissions et 7 rôles avec attributions par défaut (+ tests)                                                                                                                                                                                                                     |
| `packages/ui`                                                        | `styles.css` (`@theme` Tailwind v4), `tokens.ts`, composants : Button, Badge/StatusBadge, Panel/PageHeader/Eyebrow, Stat/StatGrid, FormField + Input/Textarea/Select/PasswordInput, EmptyState/ErrorState/ForbiddenState/LoadingState/Alert, Wordmark, OrganizationShell/PublicShell/CheckInShell |
| `packages/payments`, `packages/notifications`, `packages/scheduling` | ports (interfaces) + adaptateur console e-mail + schémas zod d'entrée/sortie du moteur de planning                                                                                                                                                                                                |
| `tests/integration`                                                  | migrations sur base vierge, idempotence, contraintes, outbox (rollback, SKIP LOCKED)                                                                                                                                                                                                              |
| `tests/security`                                                     | détection de secrets commités                                                                                                                                                                                                                                                                     |
| `tests/e2e`                                                          | config Playwright (desktop 1440 / mobile 390) + 4 tests de fumée                                                                                                                                                                                                                                  |
| `infra`                                                              | `docker-compose.yml` (Postgres 16, MinIO + init du bucket, Mailpit), `postgres/init/01-test-database.sql`                                                                                                                                                                                         |
| `docs`                                                               | `architecture.md`, `er-diagram.md`, `adr/ADR-001…005`, `ux-kit/` (références textuelles du kit), `MASTER-BUILD-PROMPT-V0.2.md`, `captures/`                                                                                                                                                       |

## 3. Migrations

`packages/database/migrations/0000_infrastructure.sql` : types `outbox_status`, `job_execution_status` ; tables `idempotency_records`, `outbox_events`, `job_executions`, `feature_flags` ; 8 index (dont 3 uniques partiels) ; 4 contraintes `CHECK`. Appliquée sur base vierge (dev et test), rejouée sans effet (test d'idempotence).

## 4. API et routes livrées

| Méthode | URL              | Auth   | Rôle                                                                                                               |
| ------- | ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| GET     | `/api/v1/health` | aucune | `200 {status:"ok", checks:{database:{ok,latencyMs}}}` ou `503 degraded` ; ping SQL réel, `Cache-Control: no-store` |
| GET     | `/`              | aucune | accueil (promesse produit, liens techniques)                                                                       |
| GET     | `/design-system` | aucune | référence visuelle, **404 en production**                                                                          |
| —       | `/_not-found`    | —      | 404 en français                                                                                                    |

## 5. Commandes exécutées et résultats réels

```
$ pnpm lint                      → exit 0   Checked 139 files. No fixes applied.
$ pnpm typecheck                 → exit 0   Tasks: 14 successful, 14 total
$ pnpm db:check                  → exit 0   Everything's fine
$ drop schema public cascade; create schema public; pnpm db:migrate
                                 → exit 0   Migrations appliquées.
$ pnpm test:unit                 → exit 0   Test Files 5 passed · Tests 24 passed
$ pnpm test:integration          → exit 0   Test Files 2 passed · Tests 8 passed
$ pnpm test:security             → exit 0   Test Files 1 passed · Tests 1 passed (139 fichiers scannés, 0 finding)
$ pnpm build                     → exit 0   Next.js: Compiled successfully (routes /, /_not-found, /api/v1/health, /design-system) ; worker typecheck OK
$ E2E_BASE_URL=http://localhost:3000 pnpm test:e2e
                                 → exit 0   8 passed (4 tests × desktop-1440 + mobile-390)
$ curl /api/v1/health            → HTTP 200 {"status":"ok","checks":{"database":{"ok":true,"latencyMs":23}}}
$ curl /design-system (prod)     → HTTP 404
$ worker (tsx src/main.ts)       → "worker started" ; heartbeat exécuté ; files pgboss créées ;
                                   SIGTERM → "worker stopping" → "pg-boss stopped" → "worker stopped"
```

Captures (`docs/captures/`) : `/design-system` à 1440 px et 390 px, accueil à 1440 px et 390 px ; aucun débordement horizontal mesuré (`scrollWidth ≤ clientWidth`), y compris à 320 px (test E2E).

## 6. Décisions et écarts documentés

- TypeScript **5.9.3** retenu plutôt que 7.0 (ADR-001). Vitest 4 plutôt que 5. Playwright 1.63 aligné sur le navigateur préinstallé.
- Migrations Drizzle : table de suivi `drizzle_migrations` placée dans le schéma `public` (et non `drizzle`) pour qu'une réinitialisation de schéma soit réellement propre.
- Le runner de migrations est exporté par `@kroov/database/migrate` et non par l'entrée principale : Turbopack refusait de bundler `new URL("../migrations")` dans le web.
- `FormField` compose par contexte React (`<FormField><Input/></FormField>`) et non par render-prop : une fonction ne peut pas traverser la frontière serveur → client.
- Relais outbox : balayage cron chaque minute (granularité de pg-boss). Les producteurs enverront un job `outbox.relay` juste après commit en phase 1 pour une latence faible.
- Biome 2.6 : `linter.rules.preset = "recommended"` (le champ `recommended` est déprécié), directives Tailwind activées dans le parseur CSS.

## 7. Limites connues

- Docker Compose n'a pas pu être exécuté dans l'environnement de validation (pas de démon Docker) ; PostgreSQL 16 a été installé localement pour valider migrations et tests. Le fichier `infra/docker-compose.yml` est fourni et sera vérifié au premier démarrage sur un poste avec Docker (MinIO et Mailpit n'ont donc pas encore été démarrés).
- Aucun service externe (Stripe, fournisseur e-mail, S3) n'est configuré ni appelé : ce sont des ports vides avec leurs contrats. Vérification externe : **en attente** (phases 3 et 8).
- Le CI GitHub Actions (`.github/workflows/ci.yml`) est écrit mais n'a pas encore tourné : il tournera au premier push.
- Le logo est une approximation typographique ; le SVG officiel remplacera `Wordmark` sans toucher aux pages.
- Les composants Table, DateTimeRange, MoneyInput, QuantityStepper, Dialog/ConfirmAction, Toast, Charts arrivent avec les phases qui en ont besoin (2, 3), pour éviter des composants sans usage réel.

## 8. Sécurité

- Validation d'environnement stricte ; aucun secret par défaut ; `.env` ignoré par git ; scanner de secrets en test et en CI.
- En-têtes de sécurité HTTP ; redaction des logs ; page de démonstration hors production.
- Reste à faire (phase 1) : sessions, CSRF, rate limiting, RBAC testé par accès direct inter-organisations.

## 9. Dépendances de la phase 1

- Table `organizations` → ajout des FK `organization_id` sur `outbox_events`, `job_executions`, `feature_flags`.
- Better Auth + adaptateur Drizzle (`AUTH_SECRET` requis en non-développement).
- `requirePermission()` dans `@kroov/auth`, seed des rôles/permissions depuis le catalogue.
- Adaptateur e-mail SMTP (Mailpit) pour les invitations et la vérification d'adresse.
- Tests de sécurité : organisation A → ressources de B par API directe avec identifiants forgés ; dernier propriétaire non supprimable.

## 10. Hypothèses non résolues (bloquantes pour des phases ultérieures, pas pour la phase 1)

1. Fournisseur de paiement : Stripe Connect est la cible du cahier des charges ; le guide UX indique « à confirmer ». Compte Stripe (test) à fournir avant la phase 3.
2. Politique de frais (acheteur / organisateur), TVA sur frais, remboursements partiels : paramètres à arbitrer (ADR-005).
3. Durée de réservation (10 min dans le kit), durée maximale de mission (6 h) et pause (30 min) : valeurs par défaut configurables, à confirmer.
4. OR-Tools (worker Python) pour la phase 6 : faisabilité d'installation à vérifier sur l'environnement cible ; repli déterministe prévu.
5. Hébergement cible (Vercel + Postgres managé ? VPS ?) : conditionne la configuration du worker (processus long) et des webhooks.

## 11. Definition of Done — phase 0

| Critère                                   | État                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Le code se construit                      | ✅ `pnpm build`                                                      |
| Typecheck                                 | ✅ 14/14 workspaces                                                  |
| Lint                                      | ✅ Biome, 0 erreur                                                   |
| Migrations sur base vierge                | ✅ dev + test, idempotence testée                                    |
| Tests d'intégration                       | ✅ 8/8                                                               |
| Tests E2E requis                          | ✅ 8/8 (desktop + mobile)                                            |
| Tests d'autorisation                      | n/a en phase 0 (catalogue testé ; RBAC en phase 1)                   |
| États chargement / vide / erreur / succès | ✅ composants livrés et rendus sur `/design-system`                  |
| Routes publiques / privées                | ✅ `/design-system` 404 en production ; aucune route privée encore   |
| Aucune UI de production sur état fabriqué | ✅ accueil et santé uniquement ; démo confinée au mode développement |
| Documentation technique                   | ✅ architecture, ER, ADR, README, rapport                            |
| Limites connues documentées               | ✅ § 7                                                               |

**Phase 0 : acceptée. Prochaine étape : phase 1 — identité et organisations.**
