# Rapport de phase 10 — Durcissement de production

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-10-plan.md`.

## 1. Périmètre livré

**Modèle de menaces** (`docs/threat-model.md`) : 16 menaces (dont les 10 du prompt maître) reliées à la mitigation dans le code et au test automatisé qui la prouve. **Limitation de débit** des surfaces publiques en PostgreSQL (partagée entre instances, 429 + `Retry-After`), sujet = adresse cliente derrière un proxy déclaré. **Confidentialité** : export JSON de ses propres données et **suppression de compte par anonymisation** orchestrée à travers tous les modules (identité, sessions, comptes, adhésions, candidatures, commandes détachées, contacts CRM, notifications), refusée tant que la personne est dernière propriétaire ; section « Mes données » sur `/moi`. **Rétention** automatisée des données techniques. **Observabilité** : identifiant de requête, journal par requête API, santé enrichie (worker, outbox), exposition Prometheus protégée. **En-têtes** CSP + HSTS. **Sessions** révocables immédiatement (plus de cache cookie). **Gardes de configuration** en production (prestataire simulé, e-mail console, secrets par défaut, http refusés au démarrage). **Accessibilité** : audit axe-core WCAG 2.1 A/AA avec contraste sur 19 écrans × 2 viewports, deux défauts corrigés. **Performance** : index des tableaux de bord, test de charge réel. **Sauvegarde / restauration** : scripts + exercice réel. **Déploiement** : Dockerfiles, compose de pré-production, `docs/deployment.md`, `docs/production-checklist.md`, runbook.

Hors périmètre, comme cadré : WAF / anti-bot, SSO, chiffrement applicatif, multi-région, téléversement de fichiers (aucune surface n'existe — vérifié, documenté dans le modèle de menaces).

## 2. Fichiers créés ou modifiés

- Base : `schema/infrastructure.ts` (`request_rate_limits`), `schema/auth.ts` (`users.deleted_at`), `schema/ticketing.ts` (3 index), migration `0010_hardening.sql`.
- Domaine : `platform/{rate-limit,retention,observability,index}.ts` (+ `platform.test.ts`), `privacy/{privacy,index}.ts` (+ `privacy.test.ts`), hooks `anonymise*` dans `identity/index.ts`, `memberships/memberships.ts`, `volunteers/applications.ts`, `ticketing/orders.ts`, `crm/contacts.ts`, `notifications/notifications.ts` ; exports `./privacy`, `./platform`.
- Config : `packages/config/src/env.ts` (`TRUST_PROXY`, `METRICS_TOKEN`, `RATE_LIMIT_FACTOR`, `productionIssues`), `.env.example`, `packages/auth/src/server.ts` (cache cookie désactivé), `env.test.ts`.
- Web : `lib/api.ts` (rate limit, `x-request-id`, journal par requête, `requestId` dans les 500), routes limitées (`public/orders`, `membership-applications`, `volunteer-applications`, `tickets/[viewToken]`, `orders/[orderId]`, `memberships/[id]`, `volunteer-applications/[id]`, `unsubscribe`, `l/[token]`), `api/v1/health`, `api/v1/metrics`, `api/v1/profiles/me/export`, `api/v1/profiles/me/delete`, `actions/identity.ts`, `app/moi/{page.tsx, privacy-panel.tsx, compte-supprime/page.tsx}`, `next.config.ts` (CSP, HSTS), `o/[slug]/user-menu.tsx` (nom accessible), `packages/ui/src/components/stat.tsx` et `styles.css` (contraste).
- Worker : `jobs/maintenance.ts` (heartbeat en base, `maintenance.retention`), `queue.ts`.
- Exploitation : `scripts/backup.sh`, `scripts/restore.sh`, `scripts/load-test.mjs`, `infra/docker/web.Dockerfile`, `infra/docker/worker.Dockerfile`, `infra/docker-compose.prod.yml`, `.dockerignore`.
- Tests : `tests/integration/platform/hardening.test.ts` (7), `tests/security/tenant-isolation.test.ts` (S12, 4), `tests/e2e/a11y.e2e.ts` (3 × 2), `tests/e2e/privacy.e2e.ts` (1 × 2), unitaires (8 : plateforme 3, confidentialité 2, gardes 3).
- Docs : `docs/phase-10-plan.md`, `docs/threat-model.md`, `docs/deployment.md`, `docs/production-checklist.md`, `docs/runbooks/backup-restore.md`, `docs/openapi.yaml` 0.10.0 (135 chemins, 107 schémas), `docs/er-diagram.md`, `docs/architecture.md` (§7 worker, §7undecies, §8), `README.md`.

## 3. Migrations

`0010_hardening` : `request_rate_limits` (`UNIQUE (scope, subject, window_start)`, `CHECK count >= 0`, index par fenêtre), `users.deleted_at`, index `orders (organization_id, status, paid_at)`, `tickets (organization_id, status)`, `refunds (organization_id, status, succeeded_at)`. Appliquée sur `kroov` et `kroov_test` ; base vierge 0000 → 0010 = 94 relations, `db:check` sans dérive ; bundle Supabase régénéré et rejoué sur base neuve (11 migrations).

## 4. API livrée

| Méthode | Chemin                      | Rôle                                                                                           |
| ------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| GET     | `/health`                   | `ok` / `degraded` / `down` (503) : base, heartbeat worker, outbox                              |
| GET     | `/metrics`                  | Prometheus, Bearer `METRICS_TOKEN` (404 si non configuré, 401 sinon)                           |
| GET     | `/profiles/me/export`       | JSON téléchargeable de ses propres données ; audité                                            |
| POST    | `/profiles/me/delete`       | `{ confirmEmail }` → anonymisation ; 412 `last_owner` ; 422 adresse inexacte ; cookies effacés |
| —       | surfaces publiques limitées | 429 `rate_limited` + `Retry-After` + `RateLimit-Limit` ; `x-request-id` sur toute réponse API  |

## 5. Routes UI livrées

`/moi` (section « Mes données » : export, suppression avec confirmation par adresse et blocage « dernière propriétaire » expliqué), `/moi/compte-supprime`. 202 routes construites.

## 6. Commandes exécutées et résultats réels

| Commande                                   | Résultat                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                | ✅ 0 erreur, 0 avertissement                                                                                                           |
| `pnpm typecheck`                           | ✅ 14/14                                                                                                                               |
| `pnpm db:check` / `db:reset` (base vierge) | ✅ aucune dérive ; 0000 → 0010, 94 relations                                                                                           |
| `pnpm test:unit`                           | ✅ 76/76 (8 nouveaux)                                                                                                                  |
| `pnpm test:integration`                    | ✅ 148/148 (7 durcissement : limiteur, concurrence, export borné, dernier propriétaire, anonymisation transverse, rétention, snapshot) |
| `pnpm test:security` (statique / live)     | ✅ 1 + 49/49 (S12 : 429 réel, en-têtes + `x-request-id`, métriques, suppression de compte par API)                                     |
| `node scripts/scan-secrets.mjs`            | ✅ 621 fichiers, 0 trouvaille                                                                                                          |
| `pnpm --filter @kroov/web build`           | ✅ 202 routes                                                                                                                          |
| `pnpm test:e2e`                            | ✅ 86/86 (suite complète, 2 viewports ; accessibilité 19 écrans, parcours « mes données »)                                             |
| `scripts/backup.sh` → `scripts/restore.sh` | ✅ dump 1,1 Mo, restauration 1,5 s, 12 tables comptées identiques, `db:migrate` sans effet (runbook)                                   |
| `node scripts/load-test.mjs … 15 20`       | ✅ voir §7 — 0 erreur, 0 réponse non-2xx                                                                                               |
| `docker build` des images                  | ⏳ Dockerfiles écrits ; **aucun démon Docker dans cet environnement** (à construire en CI / sur l'hôte)                                |
| Bundle Supabase rejoué sur base neuve      | ✅ 11 migrations, 94 relations                                                                                                         |
| Connecteur Supabase (MCP)                  | ⏳ toujours lié au mauvais projet, « connection timeout » (§8)                                                                         |

## 7. Mesures de charge (environnement de cette session : 2 vCPU, une instance web + worker, PostgreSQL local, 20 connexions, 15 s)

| Cible                               | req/s | p50    | p97,5  | p99    | max    | erreurs |
| ----------------------------------- | ----- | ------ | ------ | ------ | ------ | ------- |
| `/api/v1/health` (ping base)        | 328   | 57 ms  | 106 ms | 133 ms | 215 ms | 0       |
| tarifs publics (API, disponibilité) | 149   | 129 ms | 195 ms | 244 ms | 401 ms | 0       |
| page publique d'événement (SSR)     | 55    | 347 ms | 527 ms | 545 ms | 611 ms | 0       |
| page de connexion (HTML)            | 195   | 96 ms  | 142 ms | 151 ms | 556 ms | 0       |

Lecture : aucune erreur ni 429 sur les lectures (non limitées) ; la page publique SSR est la plus coûteuse (plusieurs requêtes par rendu). À rejouer contre la pré-production avec la base managée ; un cache de rendu court sur la page publique est l'optimisation suivante si nécessaire.

## 8. Décisions prises pendant la phase

- **Cache cookie des sessions désactivé** : une suppression de compte ou une déconnexion doit être effective immédiatement sur tous les appareils ; coût = une requête indexée par appel. Détecté par le test S12 (session encore valide 5 min après suppression).
- **Anonymisation plutôt qu'effacement** : les commandes, billets et écritures sont des preuves comptables ; l'identité est détachée (adresse technique unique par personne, noms neutralisés, `user_id` NULL, jetons d'accès révoqués par un hachage non reproductible). Les noms de participants restent sur les billets émis (titre d'admission nominatif), documenté dans l'export et l'écran.
- **Règle de dépendance respectée** : le module `privacy` n'écrit aucune table étrangère ; chaque module propriétaire expose son `anonymise*`.
- **Limiteur en fenêtre fixe PostgreSQL** plutôt qu'en mémoire : correct avec plusieurs instances, pas de dépendance Redis ; les routes authentifiées ne sont pas limitées (le RBAC les borne, et un membre légitime ne doit pas être bloqué).
- **Contraste** : une règle CSS **non superposée** (hors `@layer`) remplace le gris atténué par de l'encre adoucie sur les surfaces teintées — les couches de cascade de Tailwind v4 rendaient la version en `@layer components` inopérante (détecté par l'audit).
- **CSP pragmatique** (`'unsafe-inline'` scripts / styles, aucune origine externe) ; CSP stricte par nonce notée comme évolution.
- **Gardes de production** au niveau de la configuration (échec au démarrage) plutôt que dans chaque fabrique.

## 9. Limites connues

- **Base hébergée** : Supabase toujours injoignable depuis cet environnement ; migrations 0000 → 0010 prêtes (`.tmp/supabase/`).
- **Stripe et Resend** : adaptateurs livrés et testés sur doubles / fixtures ; vérification en sandbox réelle en attente (pas de réseau sortant ni de clés).
- **Images Docker** non construites ici (pas de démon) ; les Dockerfiles reprennent exactement les manifestes du monorepo.
- **Limitation de débit** : par adresse ; sans `TRUST_PROXY` tous les anonymes partagent le compteur `direct`. Pas de protection distribuée (à déléguer).
- **Charge** : mesures locales, non représentatives d'une base managée distante ; pas de cache de rendu.
- **Téléversements** : aucune surface ; les règles de validation sont écrites pour le jour où elle arrivera.
- **Suppression ciblée d'une organisation** depuis une sauvegarde : procédure manuelle décrite, non outillée.

## 10. Sécurité

Voir `docs/threat-model.md`. Nouveautés de phase : 429 sur les surfaces publiques, en-têtes CSP / HSTS, identifiant de requête, métriques protégées et sans donnée personnelle, suppression de compte bornée à soi et refusée au dernier propriétaire, sessions sans cache, gardes de configuration. Journaux : jamais de query string (jetons dans l'URL), redaction inchangée.

## 11. Suite

Les 10 phases du prompt maître sont livrées. Actions externes restantes (checklist §`docs/production-checklist.md`) : migrer la base Supabase, vérifier Stripe Connect et Resend en sandbox, construire les images en CI, brancher logs / métriques / alertes, publier les mentions légales, rejouer la charge en pré-production.

## 12. Definition of Done — phase 10

| Critère                                                  | État                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Le code se construit                                     | ✅ 202 routes                                                                |
| Typecheck                                                | ✅ 14/14                                                                     |
| Lint                                                     | ✅                                                                           |
| Migrations sur base vierge                               | ✅ 0000 → 0010, 94 relations, `db:check` ; bundle Supabase rejoué            |
| Tests unitaires                                          | ✅ 76/76                                                                     |
| Tests d'intégration                                      | ✅ 148/148                                                                   |
| Tests E2E requis                                         | ✅ 86/86                                                                     |
| Tests d'autorisation / sécurité                          | ✅ 49/49 par API directe (S1–S12)                                            |
| Threat modeling                                          | ✅ `docs/threat-model.md`, 16 menaces reliées aux tests                      |
| Performance / load testing                               | ✅ index + `scripts/load-test.mjs`, mesures réelles §7                       |
| Accessibility checks                                     | ✅ axe WCAG 2.1 A/AA + contraste, 19 écrans × 2 viewports, 0 violation       |
| Observability                                            | ✅ `x-request-id`, journal par requête, santé enrichie, métriques Prometheus |
| Backup and restore                                       | ✅ scripts + exercice réel (runbook)                                         |
| Deployment documentation                                 | ✅ `docs/deployment.md`, Dockerfiles, compose                                |
| Production checklist                                     | ✅ `docs/production-checklist.md` (états réels)                              |
| Privacy export & deletion                                | ✅ API + UI + tests                                                          |
| Rate limiting                                            | ✅ PostgreSQL, 429 réel testé                                                |
| Base hébergée à jour                                     | ⏳ Supabase injoignable (§9)                                                 |
| Fournisseurs de production                               | ⏳ Stripe / Resend : vérification externe en attente (§9)                    |
| Documentation (plan, OpenAPI, ER, architecture, rapport) | ✅                                                                           |
