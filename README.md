# Kroov

**Organisez vos événements, vendez vos billets, mobilisez vos bénévoles et développez votre communauté depuis un seul endroit.**

Système d'exploitation événementiel multi-organisations (billetterie native, adhésions, bénévoles et planning intelligent, CRM, marketing). Marché initial : France.

État : **Phase 10 — durcissement de production** validée (`docs/phase-10-report.md` ; rapports de chaque phase dans `docs/`). API : `docs/openapi.yaml`. Déploiement : `docs/deployment.md`, `docs/production-checklist.md`, menaces : `docs/threat-model.md`.

## Prérequis

- Node.js ≥ 22, pnpm ≥ 10 (`corepack enable` suffit : la version est épinglée dans `package.json`)
- Docker Desktop (PostgreSQL 16, MinIO, Mailpit) **ou** un PostgreSQL 16 local
- Navigateurs Playwright pour les tests de bout en bout : `pnpm exec playwright install chromium`

## Démarrage local

```bash
pnpm install                 # dépendances (lockfile épinglé)
cp .env.example .env         # configuration locale, jamais commitée
pnpm infra:up                # Postgres :5432, MinIO :9000/:9001, Mailpit :8025
pnpm db:migrate              # applique les migrations SQL (packages/database/migrations)
pnpm dev                     # web http://localhost:3000 + worker
```

Sans Docker : créez les bases `kroov` et `kroov_test` (utilisateur `kroov` / `kroov`) puis exécutez `pnpm db:migrate`.

Pages utiles en développement :

- `http://localhost:3000/` — accueil → inscription / connexion
- `http://localhost:3000/organisations` — vos organisations (création, invitation de l'équipe)
- `http://localhost:3000/api/v1/health` — état réel du service (base de données incluse)
- `http://localhost:3000/design-system` — référence visuelle (404 en production)

## Commandes

| Commande                      | Rôle                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm lint:fix` | Biome (lint + format)                                                                                            |
| `pnpm typecheck`              | `tsc --noEmit` sur chaque workspace                                                                              |
| `pnpm test:unit`              | tests unitaires (packages, apps)                                                                                 |
| `pnpm test:integration`       | tests sur PostgreSQL réel (`DATABASE_URL_TEST`)                                                                  |
| `pnpm test:security`          | tests négatifs ; avec `E2E_BASE_URL` : isolation tenant par API directe (voir `tests/security/README.md`)        |
| `pnpm test:e2e`               | Playwright (desktop 1440 px, mobile 390 px) ; `E2E_BASE_URL` pour cibler un serveur déjà lancé                   |
| `pnpm build`                  | build de production (Next.js + typecheck worker)                                                                 |
| `pnpm validate`               | lint + typecheck + unit + build                                                                                  |
| `pnpm db:generate`            | génère une migration SQL depuis le schéma Drizzle                                                                |
| `pnpm db:migrate`             | applique les migrations                                                                                          |
| `pnpm db:check`               | vérifie la cohérence schéma / migrations                                                                         |
| `pnpm db:reset`               | **dev uniquement** : recrée la base locale et migre                                                              |
| `pnpm secrets:scan`           | recherche de secrets commités                                                                                    |
| `scripts/backup.sh [dir]`     | sauvegarde `pg_dump` (format custom) + empreinte ; `scripts/restore.sh <dump> <url>` restaure dans une base vide |
| `scripts/load-test.mjs`       | test de charge local (autocannon) sur les surfaces publiques                                                     |

## Structure

Voir `docs/architecture.md` (vue d'ensemble, règles de dépendance entre modules, conventions) et `docs/adr/` (décisions).

## Variables d'environnement

Toutes les variables sont déclarées et validées dans `packages/config/src/env.ts`. Le fichier `.env` vit à la racine du dépôt ; les variables déjà présentes dans le processus (CI, hébergeur) ont priorité. Les valeurs vides signifient « non configuré ». Aucun secret n'a de valeur par défaut.

## E-mails en local

`EMAIL_PROVIDER=console` affiche les liens (vérification, réinitialisation, invitation) dans la console du serveur ; `smtp` les envoie à Mailpit (`http://localhost:8025`) ; `file` les écrit en JSON lines (`EMAIL_FILE_PATH`) pour les tests. `console` et `file` sont refusés en production et préproduction (`APP_ENV`).

## Données de démonstration

Les scénarios du kit UX (Le Collectif des Nuits, Les Nuits en Commun, commande KR-1048, etc.) sont des données fictives. Elles n'apparaissent que dans des fixtures de test et sur la page `/design-system` (désactivée en production). Aucune route de production ne repose sur des données fabriquées.
