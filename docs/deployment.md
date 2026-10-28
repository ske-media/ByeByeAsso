# Déploiement de Kroov

Phase 10 · 28 octobre 2026. Deux processus (web Next.js + worker pg-boss), une base PostgreSQL 16 autoritaire, aucun autre service obligatoire (le stockage objet S3 n'est pas encore utilisé).

## 1. Topologie

```
Internet ──TLS──▶ reverse proxy / hébergeur (x-forwarded-for, x-request-id)
                       │
                       ├──▶ web (Next.js, port 3000)  ── n instances possibles
                       └──▶ (rien : le worker n'expose aucun port)
web ──────────────▶ PostgreSQL (schéma public + schéma pgboss)
worker ───────────▶ PostgreSQL (files pg-boss, outbox, jobs planifiés)
web / worker ─────▶ Stripe (API + webhooks entrants), Resend (API + webhooks entrants)
```

- **web** : rendu serveur, `/api/v1`, server actions. Sans état : plusieurs instances derrière le proxy (sessions, limitation de débit et files vivent dans PostgreSQL).
- **worker** : relais outbox, consommateur `domain.events`, expiration des réservations, réconciliation des paiements, adhésions, campagnes, rétention, heartbeat. **Une instance suffit** ; plusieurs sont sûres (`FOR UPDATE SKIP LOCKED` partout).
- **migrations** : exécutées **avant** la mise en service des nouvelles versions (`pnpm db:migrate`, idempotent, table `drizzle_migrations`). Jamais de `drizzle-kit push` en production.

## 2. Variables d'environnement

Toutes validées au démarrage (`packages/config/src/env.ts`) ; en `production` / `staging`, les gardes refusent les valeurs de développement (prestataire simulé, e-mail console, secret de webhook par défaut, `http://`, identifiants `kroov:kroov`).

| Variable                                                                 | Obligatoire en production      | Rôle                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                                | oui (`production`)             | profil d'exécution (gardes, cookies sécurisés, HSTS, CSP `upgrade-insecure-requests`)                    |
| `APP_URL`, `NEXT_PUBLIC_APP_URL`                                         | oui (`https://…`)              | origine publique (liens dans les e-mails, vérification d'origine CSRF)                                   |
| `APP_NAME`, `NEXT_PUBLIC_APP_NAME`                                       | non                            | nom affiché                                                                                              |
| `DATABASE_URL`                                                           | oui                            | PostgreSQL (pooler en mode _transaction_ accepté : aucune fonctionnalité de session n'est utilisée)      |
| `DATABASE_POOL_MAX`                                                      | non (10)                       | taille du pool par processus                                                                             |
| `AUTH_SECRET`                                                            | oui (≥ 32 car.)                | sessions Better Auth + dérivation HMAC de tous les jetons (commandes, billets, QR, adhésions, candidats) |
| `PAYMENT_PROVIDER`                                                       | oui (`stripe`)                 | `fake` interdit en production                                                                            |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID` | oui                            | Stripe Connect ; le webhook pointe sur `/api/v1/payments/webhooks/stripe`                                |
| `PLATFORM_FEE_BPS`, `PLATFORM_FEE_FIXED_MINOR`                           | non (400 / 0)                  | commission plateforme à la charge de l'acheteur                                                          |
| `EMAIL_PROVIDER`                                                         | oui (`resend` ou `smtp`)       | `console` / `file` réservés au développement et aux tests                                                |
| `RESEND_API_KEY` ou `SMTP_URL`                                           | oui selon le fournisseur       |                                                                                                          |
| `EMAIL_FROM`                                                             | oui                            | expéditeur transactionnel (domaine authentifié SPF / DKIM / DMARC)                                       |
| `EMAIL_WEBHOOK_SECRET`                                                   | oui                            | signature des rappels e-mail (`/api/v1/email/webhooks/{provider}`)                                       |
| `CAMPAIGN_BATCH_SIZE`                                                    | non (50)                       | lots d'envoi des campagnes                                                                               |
| `WORKER_CONCURRENCY`                                                     | non (4)                        | connexions du worker                                                                                     |
| `TRUST_PROXY`                                                            | oui (`true` derrière un proxy) | lit `x-forwarded-for` pour la limitation de débit — **jamais** sans proxy de confiance                   |
| `METRICS_TOKEN`                                                          | recommandé (≥ 16 car.)         | active `GET /api/v1/metrics` (Bearer) ; vide = désactivé                                                 |
| `RATE_LIMIT_FACTOR`                                                      | non (1)                        | multiplie toutes les limites publiques                                                                   |
| `LOG_LEVEL`                                                              | non (`info`)                   | pino, JSON sur stdout                                                                                    |
| `S3_*`                                                                   | non                            | posé pour le stockage objet (non utilisé à ce jour)                                                      |

Aucun secret n'a de valeur par défaut utilisable en production. Le `.env` n'est jamais commité ; les variables du processus (hébergeur) ont priorité.

## 3. Construire et lancer

### Images (fournies, non construites dans cet environnement — pas de démon Docker)

```bash
docker build -f infra/docker/web.Dockerfile    -t kroov-web .
docker build -f infra/docker/worker.Dockerfile -t kroov-worker .
# ou, sur un hôte unique de pré-production :
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
```

Ordre de mise en service : `migrate` (worker image, `pnpm db:migrate`) → `web` → `worker`. Le `HEALTHCHECK` de l'image web interroge `/api/v1/health`.

### Sans conteneur

```bash
pnpm install --frozen-lockfile
pnpm db:migrate                              # DATABASE_URL de production
pnpm --filter @kroov/web build && pnpm --filter @kroov/web start   # :3000
pnpm --filter @kroov/worker start            # tsx src/main.ts
```

Node ≥ 22, pnpm 10 (corepack). Le worker et le web partagent la même configuration.

## 4. Reverse proxy

- Termine TLS ; transmet `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, et idéalement `X-Request-Id` (sinon le web en génère un et le renvoie).
- Ne doit pas réécrire les en-têtes de sécurité posés par l'application (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).
- Corps : les webhooks sont vérifiés sur le **corps brut** — pas de transformation.
- Timeouts ≥ 30 s sur `/api/v1/organizations/*/schedule-*` (génération de planning en ligne, bornée à 5 s) et sur les exports CSV.

## 5. Webhooks

| Fournisseur | URL                                     | Secret                        | Idempotence                                 |
| ----------- | --------------------------------------- | ----------------------------- | ------------------------------------------- |
| Stripe      | `POST /api/v1/payments/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET`       | `payment_webhook_events (provider, event)`  |
| Resend      | `POST /api/v1/email/webhooks/resend`    | `EMAIL_WEBHOOK_SECRET` (svix) | `message_deliveries (provider, message id)` |

Événements Stripe à abonner (ceux que l'adaptateur traite) : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.refund.updated`, `refund.failed`, `account.updated` (Connect). Un webhook non signé répond 400 ; un prestataire non configuré 404.

## 6. Observabilité

- Logs JSON (pino) sur stdout : une ligne par requête API (`requestId`, méthode, chemin sans query string, statut, durée), erreurs avec `requestId`, redaction des secrets.
- `GET /api/v1/health` : `ok` / `degraded` (worker sans heartbeat depuis 3 min, lignes outbox `failed`, arriéré > 5 min) / `down` (503, base injoignable).
- `GET /api/v1/metrics` (Bearer `METRICS_TOKEN`) : `kroov_database_up`, `kroov_database_latency_ms`, `kroov_worker_alive`, `kroov_worker_heartbeat_age_seconds`, `kroov_outbox_events{status}`, `kroov_outbox_oldest_pending_seconds`, `kroov_queue_jobs{queue,state}`, `kroov_orders_paid_24h`, `kroov_payment_webhooks_failed_24h`.
- Alertes recommandées : `kroov_worker_alive == 0` pendant 5 min ; `kroov_outbox_events{status="failed"} > 0` ; `kroov_payment_webhooks_failed_24h > 0` ; latence p95 `/api/v1/health` > 500 ms.

## 7. Sauvegarde et restauration

Voir `docs/runbooks/backup-restore.md` (scripts `scripts/backup.sh` / `scripts/restore.sh`, exercice réel documenté). Avec une base managée (Supabase, RDS), activer en plus les sauvegardes automatiques et le PITR du fournisseur ; les scripts restent le moyen de vérifier qu'une restauration fonctionne.

## 8. Mise à l'échelle et limites

- Web : horizontal (sans état). Worker : une instance ; plusieurs tolérées.
- Base : index de la phase 10 pour les tableaux de bord ; pas de cache applicatif. Mesures locales (2 vCPU, une instance, `scripts/load-test.mjs`) dans `docs/phase-10-report.md`.
- Pas de CDN ni de WAF intégré : à déléguer à l'hébergeur (le proxy doit poser `x-forwarded-for`).
- Fichiers : aucun téléversement ; les affiches sont générées en CSS.
