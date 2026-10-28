# Checklist de mise en production — Kroov

État au 28 octobre 2026 (fin de phase 10). ✅ fait et vérifié · ⏳ prêt, action externe requise · ☐ à faire par l'équipe au moment du déploiement.

## Code et qualité

- ✅ Build de production (`pnpm build`), typecheck 14/14, lint 0 erreur.
- ✅ Tests : unitaires, intégration (PostgreSQL réel), sécurité par API directe (S1–S12), E2E desktop + mobile, accessibilité axe (A/AA, contraste inclus) — exécutés en CI (`.github/workflows/ci.yml`).
- ✅ Aucune donnée fabriquée dans les écrans de production (compteurs à « — » sans accès, états vides explicites).
- ✅ Scan de secrets (`scripts/scan-secrets.mjs`) : 0 trouvaille.

## Configuration

- ✅ Gardes de production dans `loadServerEnv` : refus du prestataire simulé, des e-mails console/file, du secret de webhook par défaut, d'`APP_URL` non https, d'identifiants `kroov:kroov`.
- ☐ `AUTH_SECRET` généré (≥ 32 caractères aléatoires), stocké dans le gestionnaire de secrets de l'hébergeur. **Le changer invalide tous les liens signés** (billets, commandes, adhésions, candidatures) : à ne faire qu'en connaissance de cause.
- ☐ `APP_ENV=production`, `APP_URL=https://…`, `TRUST_PROXY=true` (derrière le proxy déclaré), `METRICS_TOKEN` défini.
- ☐ `DATABASE_URL` vers la base managée (pooler transaction OK), `DATABASE_POOL_MAX` cohérent avec le pooler.

## Base de données

- ✅ Migrations 0000 → 0010 rejouées sur base vierge et via le bundle Supabase (`node scripts/supabase-bundle.mjs`).
- ⏳ **Base hébergée Supabase** : à migrer (`pnpm db:migrate` avec l'URL du pooler, ou coller `.tmp/supabase/00xx_*.sql` dans l'ordre). Le connecteur MCP de cet environnement reste lié au mauvais projet et injoignable.
- ☐ Sauvegardes automatiques + PITR du fournisseur activés ; exercice de restauration refait sur la base de production (runbook `docs/runbooks/backup-restore.md`).
- ✅ Rétention des données techniques automatisée (`maintenance.retention`, quotidien).

## Paiement et e-mail

- ⏳ **Stripe Connect** : adaptateur livré ; vérifier en sandbox réelle (clés `sk_test_`, `whsec_`), créer l'endpoint webhook avec les 8 événements listés dans `docs/deployment.md` §5, tester un remboursement partiel et un paiement tardif.
- ⏳ **Resend** : adaptateur livré ; vérifier l'envoi réel, configurer le domaine (SPF, DKIM, DMARC), le webhook svix (`EMAIL_WEBHOOK_SECRET`), un rebond dur et une plainte.
- ☐ `EMAIL_FROM` sur le domaine authentifié ; adresse de réponse par organisation renseignée dans les campagnes.

## Sécurité

- ✅ Modèle de menaces (`docs/threat-model.md`) relié aux tests.
- ✅ RBAC deny-by-default, isolation tenant par FK composites, CSRF (origine), cookies `Secure` + `SameSite` en production, sessions révocables immédiatement (pas de cache cookie).
- ✅ Limitation de débit : Better Auth (connexion, inscription, réinitialisation) + PostgreSQL sur les surfaces publiques (429 + `Retry-After`).
- ✅ En-têtes : CSP, HSTS (production / staging), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- ✅ Webhooks signés sur le corps brut, idempotents ; jetons dérivés jamais stockés ; QR jamais loggé.
- ✅ Export des données personnelles et suppression de compte (anonymisation) ; consentements journalisés avec preuve.
- ☐ TLS, WAF / anti-bot et protection DDoS du côté de l'hébergeur ou du CDN.
- ☐ Revue de la CSP si un script tiers est ajouté un jour (aucun aujourd'hui) ; évolution vers une CSP stricte par nonce.

## Observabilité et exploitation

- ✅ Logs JSON (pino) avec `requestId`, redaction ; `/api/v1/health` (base, worker, outbox) ; `/api/v1/metrics` (Prometheus, Bearer).
- ☐ Collecte des logs et des métriques branchée ; alertes : worker sans heartbeat 5 min, outbox `failed > 0`, webhooks paiement en échec, p95 santé > 500 ms, erreurs 5xx.
- ☐ Astreinte / contact pour les incidents de paiement (remboursements automatiques de doublons, paiements tardifs).

## Performance

- ✅ Index des tableaux de bord et listes (phase 10) ; test de charge local documenté dans `docs/phase-10-report.md` (aucune erreur à 20 connexions, p50 page publique 347 ms sur 2 vCPU).
- ☐ Rejouer `scripts/load-test.mjs` contre la pré-production avec la base managée ; dimensionner le pool et le nombre d'instances web.

## Juridique et contenu

- ☐ Mentions légales, CGU / CGV, politique de confidentialité et de cookies publiées (liens du pied de page : « Conditions · Confidentialité »).
- ☐ Registre des traitements : commandes (acheteur, participants), adhésions, candidatures bénévoles (année de naissance, compétences), contacts et consentements marketing, notifications internes ; durées de conservation alignées sur `docs/threat-model.md` §16 et la rétention automatisée.
- ☐ Adresse de contact DPO / support dans les e-mails transactionnels.

## Lancement

- ☐ Organisation pilote créée, compte de paiement Stripe Connect connecté et actif, premier événement publié avec billetterie ouverte, un achat réel de 1 € puis remboursé.
- ☐ Plan de retour arrière : image précédente + base restaurable (les migrations sont additives ; aucune migration ne supprime de colonne à ce jour).
