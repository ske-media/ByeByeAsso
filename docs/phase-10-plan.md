# Phase 10 — Durcissement de production — cadrage

Date : 28 octobre 2026. Précède l'implémentation (§22 du prompt maître).

## 1. Périmètre

**Modèle de menaces** écrit et relié au code et aux tests (chaque menace du §18 : mitigation, où elle vit, quel test la couvre). **Limitation de débit** sur les surfaces publiques et anonymes (`/api/v1/public/*`, `/l/{token}`, rappels fournisseur), en base PostgreSQL (fenêtre fixe par clé + adresse, plusieurs instances web possibles), 429 + `Retry-After`. **Confidentialité** : export des données personnelles (`GET /api/v1/profiles/me/export`, JSON) et **suppression de compte** (`POST /api/v1/profiles/me/delete`) avec anonymisation — refusée tant que la personne est dernière propriétaire d'une organisation ; les enregistrements financiers (commandes, grand livre) sont conservés (obligation légale) mais détachés de l'identité ; sessions et comptes OAuth supprimés ; audit. **Rétention** : job `maintenance.retention` (quotidien) purgeant outbox `dispatched` > 30 j, `job_executions` > 90 j, compteurs de débit > 1 j. **Observabilité** : identifiant de requête (`x-request-id` lu ou généré, renvoyé, dans les logs), durée et statut par requête API, `GET /api/v1/health` enrichi (base, dernier heartbeat worker, arriéré outbox pending / failed, files pg-boss), `GET /api/v1/metrics` (exposition Prometheus texte, jeton `METRICS_TOKEN`). **En-têtes** : `Content-Security-Policy` (pragmatique : `'self'` + `unsafe-inline` pour les scripts/styles inline de Next, `img-src data: blob:`, `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`), `Strict-Transport-Security` hors développement. **Performance** : revue des index au service des tableaux de bord et des listes (phase 9) + test de charge local (`autocannon`) sur page publique d'événement, disponibilité billetterie, santé — résultats réels dans le rapport. **Accessibilité** : audit automatisé axe-core (Playwright) sur les écrans clés, corrections des violations `serious` / `critical`. **Sauvegarde / restauration** : `scripts/backup.sh` (`pg_dump` format custom) et `scripts/restore.sh` (base neuve + `pg_restore` + vérification `drizzle_migrations`), exercice réel exécuté. **Déploiement** : `Dockerfile` web et worker (multi-étapes), `infra/docker-compose.prod.yml`, `docs/deployment.md` (variables, migrations, reverse proxy, webhooks Stripe / Resend, mise à l'échelle), **checklist de mise en production** (`docs/production-checklist.md`) avec l'état réel de chaque point.

Hors périmètre : WAF / anti-bot externe, SSO entreprise, chiffrement applicatif des colonnes, multi-région, HA PostgreSQL (délégué à l'hébergeur), téléversement de fichiers (aucune surface d'upload n'existe : `stored_files` est posée, non servie — documenté).

## 2. Existant réutilisé

`apiRoute` (CSRF, erreurs uniformes), Better Auth (sessions en base, cookies sécurisés en production, rate limiting des routes d'auth), `audit_logs`, `job_executions` (heartbeat), outbox + requeue borné (phase 9), `scripts/scan-secrets.mjs`, CI GitHub Actions, `infra/docker-compose.yml`, `docs/openapi.yaml`.

## 3. Changements de base (migration `0010_hardening`)

| Table / index                                                                                                                                                                                                                 | Rôle                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `request_rate_limits`                                                                                                                                                                                                         | compteurs par `(scope, subject, window_start)` — `UNIQUE`, `CHECK count >= 0`                     |
| `users.deleted_at`, `user_profiles` anonymisés                                                                                                                                                                                | suppression de compte : identité remplacée, `deleted_at` posé, `email` → adresse technique unique |
| index `orders (organization_id, status, paid_at)`, `tickets (organization_id, status)`, `refunds (organization_id, status)`, `ledger_transactions (organization_id, occurred_at)`, `audit_logs (organization_id, created_at)` | requêtes des tableaux de bord / finances / journal sans parcours complet                          |

## 4. API et UI

- `GET /api/v1/profiles/me/export` (JSON : profil, organisations et rôles, adhésions, commandes rattachées à l'adresse, candidatures bénévoles, notifications, préférences, journal d'audit de ses propres actions) ; `POST /api/v1/profiles/me/delete { confirmEmail }` (412 `last_owner` avec la liste des organisations ; 200 puis déconnexion).
- `GET /api/v1/health` enrichi ; `GET /api/v1/metrics` (jeton).
- UI : section « Mes données » sur `/moi` (export, suppression avec confirmation par e-mail saisi, conséquences écrites) ; page de confirmation après suppression.

## 5. Sécurité

Limitation de débit par adresse (`x-forwarded-for` de confiance uniquement derrière le proxy déclaré : `TRUST_PROXY=true`), jamais sur les routes authentifiées (le RBAC les borne) ; suppression de compte = action de la personne elle-même uniquement, auditée, irréversible, jamais sur un dernier propriétaire ; export borné à la personne ; métriques sans donnée personnelle ; CSP sans origine externe ; HSTS en production.

## 6. Tests attendus

Unitaires : fenêtre de débit, anonymisation (format d'adresse, champs nettoyés), rendu Prometheus. Intégration : rate limiter (compteur, fenêtre, concurrence), export (contenu borné à la personne), suppression (dernier propriétaire refusé, membre simple anonymisé, sessions purgées, commandes conservées sans identité, candidatures bénévoles anonymisées), rétention (purge bornée), santé / métriques. Sécurité S12 : 429 réel sur une route publique, compte supprimé → connexion refusée, métriques sans jeton → 401, en-têtes CSP / HSTS présents, `x-request-id` renvoyé. E2E : audit axe sur les écrans clés (0 violation `serious` / `critical`), parcours « exporter mes données puis supprimer mon compte ». Exercice réel de sauvegarde / restauration et test de charge exécutés et rapportés.

## 7. Hypothèses (décidées)

- Pas d'anonymisation des commandes elles-mêmes (preuve comptable) : l'e-mail acheteur est remplacé par l'adresse technique, les noms de participants conservés sur les billets déjà émis (titre de transport nominatif) — documenté dans l'export et la politique de rétention.
- La CSP tolère `'unsafe-inline'` pour scripts et styles (Next.js App Router sans nonce) ; une CSP stricte par nonce est notée comme évolution.
- `autocannon` en devDependency ; les chiffres de charge sont ceux de cet environnement (une machine, une instance), donnés pour comparaison, pas comme capacité garantie.
