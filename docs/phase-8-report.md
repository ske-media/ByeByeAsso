# Rapport de phase 8 — Marketing responsable

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-8-plan.md`.

## 1. Périmètre livré

Campagnes e-mail par organisation : brouillons (objet, pré-en-tête, expéditeur, réponse, corps en **Markdown restreint** avec personnalisation, aucun HTML brut), **gabarits** réutilisables, **aperçu** HTML responsive + texte, **e-mail de test** à soi-même (journalisé, sans toucher aux destinataires), audience = segment de la phase 7, **vérification avant envoi** (écran 21 : segment − sans consentement − exception client − exclu·es − invalides − doublons = destinataires réels), **décision légale explicite et tracée** pour inclure l'exception « client existant » (justification obligatoire), envoi immédiat ou **programmation**, instantanés d'audience (vérification, programmation, envoi), **revalidation de l'éligibilité à l'envoi** par le worker, **envoi asynchrone par lots** avec tentatives bornées et reprise sans doublon, **un message au plus par adresse**, journal de livraison, **rappels fournisseur signés** (livré, rebond dur → exclusion, plainte → exclusion, idempotents), **désinscription en un clic sans connexion** (page + `List-Unsubscribe` / `List-Unsubscribe-Post`), **liens suivis** (clics par destinataire, sans IP, redirection seulement vers la cible enregistrée) avec paramètres de source, **attribution** des commandes au niveau du lien et **chiffre d'affaires confirmé** (commandes payées), **rapport de campagne** avec mention explicite de l'attribution incomplète, états brouillon / programmée / envoi en cours / envoyée / partiellement échouée / échouée / annulée (jamais d'annulation après lancement), adaptateur **Resend** (requête documentée ; vérification externe en attente). Écrans : 19, 20, 21, rapport, gabarits, page publique de désinscription ; nav « Marketing ».

Hors périmètre, comme cadré : éditeur visuel par blocs, A/B, pixel d'ouverture (volontairement absent), SMS, `notification_preferences` / `notifications` internes (phase 9), import de contacts.

## 2. Fichiers créés ou modifiés

| Zone                     | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database`      | `schema/marketing.ts` (7 tables, 5 enums), `orders` + `campaign_id` / `tracking_link_id` / `campaign_recipient_id` (FK composites), migration `0008_marketing.sql`                                                                                                                                                                                                                                                         |
| `packages/config`        | `EMAIL_WEBHOOK_SECRET`, `CAMPAIGN_BATCH_SIZE` ; slugs réservés `marketing`, `desinscription`, `l`                                                                                                                                                                                                                                                                                                                          |
| `packages/notifications` | `resend.ts` (adaptateur HTTP, `List-Unsubscribe`, clé d'idempotence) + test unitaire ; fabrique câblée                                                                                                                                                                                                                                                                                                                     |
| `packages/domain`        | `marketing/` : `render` (pur), `state-machine`, `schemas`, `campaigns` (gabarits, campagnes, audience, envoi, destinataires, rapport, suivi, attribution, désinscription, rappels), `webhooks` (signatures Kroov / svix), `index` — 2 132 lignes ; `ticketing/orders.ts` : attribution à la réservation (`resolveAttribution`) ; `ticketing/schemas.ts` : `attribution` sur la commande publique                           |
| `apps/worker`            | `jobs/marketing.ts` (`campaigns.dispatch`, chaque minute), file déclarée, enregistré dans `main.ts`                                                                                                                                                                                                                                                                                                                        |
| `apps/web`               | `lib/marketing.ts`, `actions/marketing.ts`, 9 routes `/api/v1/*` + `/l/[token]` + `/api/v1/public/unsubscribe/[ref]` + `/api/v1/email/webhooks/[provider]`, pages `/o/[slug]/marketing` (19), `…/nouvelle`, `…/[campaignId]` (20 / rapport), `…/[campaignId]/verification` (21), `…/gabarits`, page publique `/desinscription/[ref]`, `AttributionKeeper` sur la page événement et le choix des billets, nav « Marketing » |
| `scripts`                | `test-server.sh` lance aussi le worker (envoi réel pendant les E2E)                                                                                                                                                                                                                                                                                                                                                        |
| `tests`                  | unitaires `render.test.ts` (3), `webhooks.test.ts` (2), `resend.test.ts` (2) ; intégration `marketing/marketing.test.ts` (11) ; sécurité S10 (3) ; E2E `marketing.e2e.ts` (3 parcours × 2 viewports, worker réel)                                                                                                                                                                                                          |
| `docs`                   | `phase-8-plan.md`, `openapi.yaml` (0.8.0 : 119 chemins, 94 schémas), `er-diagram.md`, `architecture.md` (§7nonies + worker), captures `phase8-*`                                                                                                                                                                                                                                                                           |

## 3. Migrations

`0008_marketing.sql` : 7 tables (`email_templates`, `campaigns`, `campaign_audiences`, `campaign_recipients`, `message_deliveries`, `tracking_links`, `tracking_events`), 5 enums, 6 index uniques (dont **`campaign_recipients (campaign_id, email)`** — un message par adresse —, `message_deliveries (provider, provider_message_id)` — rappels idempotents —, `tracking_links (token)` et `(campaign_id, target_url)`), 10 index, 12 `CHECK` (états ⇒ horodatages, compteurs ≥ 0, jeton 16–64, cible `http(s)` seulement, user-agent ≤ 200, e-mail minuscule, stage d'instantané), 17 FK dont les composites tenant-safe et les 3 FK d'attribution sur `orders` (`SET NULL`). Appliquée sur base vierge (`db:reset` : 90 tables), `db:check` cohérent ; bundle Supabase régénéré (`.tmp/supabase/0000…0008`) et rejoué sur une base neuve : 90 tables, 9 lignes de journal.

## 4. API livrée

| Méthode              | URL                                                                                                  | Permission / accès                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET / POST           | `/organizations/{id}/email-templates` · PATCH / DELETE `…/email-templates/{templateId}`              | `campaigns.manage` ; PATCH partiel conserve les champs omis                                             |
| GET / POST           | `/organizations/{id}/campaigns?status`                                                               | `campaigns.manage` ; segment / gabarit étrangers 422                                                    |
| GET / PATCH / DELETE | `…/campaigns/{campaignId}` (détail + rapport + aperçu · brouillon seul · annulation avant lancement) | `campaigns.manage` / `campaigns.manage` (412 `campaign_locked`, 409 `stale_version`) / `campaigns.send` |
| GET                  | `…/campaigns/{campaignId}/preview`                                                                   | `campaigns.manage`                                                                                      |
| POST                 | `…/campaigns/{campaignId}/test`                                                                      | `campaigns.manage` ; à l'utilisateur connecté ; 412 `provider_failed`                                   |
| POST                 | `…/campaigns/{campaignId}/check` `{ includeCustomerException? }`                                     | `campaigns.manage` → `AudienceCheck` (motifs détaillés)                                                 |
| POST                 | `…/campaigns/{campaignId}/schedule` `{ sendAt?, includeCustomerException?, legalNote?, version? }`   | `campaigns.send` ; 422 champs manquants / note légale ; 412 `no_recipients` ; 409 stale                 |
| POST                 | `…/campaigns/{campaignId}/unschedule`                                                                | `campaigns.send` ; seulement `scheduled`                                                                |
| GET                  | `…/campaigns/{campaignId}/recipients?status&page&pageSize`                                           | `campaigns.manage`                                                                                      |
| GET                  | `/l/{token}?r=`                                                                                      | public ; 302 vers la cible enregistrée + `utm_*` + `kc` ; 404 sinon                                     |
| GET / POST           | `/api/v1/public/unsubscribe/{ref}`                                                                   | public ; référence signée ; POST one-click ; 404 uniforme                                               |
| POST                 | `/api/v1/email/webhooks/{provider}`                                                                  | serveur → serveur ; signature sur le corps brut ; fournisseur configuré seul (404)                      |

## 5. Routes UI livrées

Organisateur : `/o/[slug]/marketing` (indicateurs ; campagnes avec statut, audience / éligibles, envoyés / échecs, date ; gabarits ; segments), `/o/[slug]/marketing/nouvelle` et `/o/[slug]/marketing/[campaignId]` en brouillon (éditeur : nom, audience, gabarit, expéditeur, réponse, objet, pré-en-tête, corps avec aide-mémoire ; aperçu HTML / texte dans une iframe isolée ; « M'envoyer un test » ; « Vérifier et envoyer » ; annulation), `/o/[slug]/marketing/[campaignId]/verification` (recomptage avec motifs, aperçu, décision légale avec justification, maintenant / programmer, confirmation), `/o/[slug]/marketing/[campaignId]` après programmation (déprogrammer / annuler) et après lancement (rapport : audience, éligibles, envoyés, clics ; destinataires filtrables avec motif d'exclusion, tentatives, clics ; liens suivis ; attribution avec mention d'incomplétude ; dernier contrôle d'audience ; livraisons), `/o/[slug]/marketing/gabarits`. Public : `/desinscription/[ref]` (confirmation sans connexion, état « déjà désinscrit·e », lien de test expliqué).

## 6. Commandes exécutées et résultats réels

```
$ pnpm lint                              → exit 0   Checked 530 files. No fixes applied.
$ pnpm typecheck                         → exit 0   Tasks: 14 successful, 14 total
$ pnpm db:check                          → exit 0   Everything's fine
$ DATABASE_URL=…kroov_test pnpm db:reset → exit 0   Base réinitialisée et migrée. (0000 → 0008, 90 tables)
$ pnpm test:unit                         → exit 0   13 fichiers · 62 tests (55 phases 0–7 + 7 rendu / rappels / Resend)
$ pnpm test:integration                  → exit 0   11 fichiers · 123 tests (112 phases 0–7 + 11 marketing)
$ pnpm test:security (statique)          → exit 0   1 test, 41 ignorés sans serveur (voulu)
$ node scripts/scan-secrets.mjs          → exit 0   553 fichiers, 0 finding
$ pnpm build                             → exit 0   Next.js compilé, 183 routes ; worker OK
$ scripts/test-server.sh start           → server up (web + worker, APP_ENV=test, EMAIL_PROVIDER=file)
$ E2E_BASE_URL=… pnpm test:security      → exit 0   2 fichiers · 42 tests (39 phases 1–7 + 3 phase 8)
$ E2E_BASE_URL=… pnpm test:e2e           → exit 0   70 passed (35 desktop-1440 + 35 mobile-390) — envoi réel par le worker (journal : « campaigns dispatched » ×2)
$ timeout 25 pnpm --filter @kroov/worker dev → "worker started" (file campaigns.dispatch enregistrée)
$ node scripts/supabase-bundle.mjs + rejeu sur base neuve → 90 tables, 9 migrations journalisées
$ Supabase MCP list_tables               → "Database is possibly not accessible at the moment" (inchangé)
```

Cas unitaires (réellement exécutés) : personnalisation et échappement (aucun HTML brut, scripts neutralisés), titres / listes / paragraphes / boutons, liens réécrits vers le suivi, URL non `http(s)` ignorées, paramètres de source sans écraser l'existant ; signatures Kroov HMAC (forgée rejetée, corps modifié rejeté) et svix/Resend (tolérance d'horodatage, signatures multiples, rebond transitoire ≠ dur, événements non pertinents ignorés) ; requête Resend (auth, idempotence, `List-Unsubscribe`, tags) et échec 429 remonté.

Cas d'intégration notables : machine à états (lancée ≠ annulable) ; gabarits et campagnes par organisation, lecteur sans `campaigns.*` 403, segment de B refusé, autre organisation 404 ; **mise à jour partielle qui conserve les autres champs** (régression corrigée pendant la phase) ; aperçu personnalisé avec lien de désinscription et `utm_campaign` ; e-mail de test au seul expéditeur, `kind = test`, aucun destinataire créé ; recomptage : 5 contacts → 2 éligibles, exception client +1 ; programmation : `campaigns.send` requis, champs manquants 422, note légale obligatoire 422, zéro éligible 412, programmation différée non déclenchée, verrouillage du brouillon, déprogrammation, envoi immédiat ; **contact désinscrit après la programmation absent de l'envoi** ; lots de 2 avec tentatives (échec puis succès), un seul message en boîte de sortie, `List-Unsubscribe` dérivé, relance du worker sans renvoi, annulation refusée ; échec définitif → destinataire `failed`, campagne `partially_failed` ; clic suivi (événement sans IP, clics uniques, redirection avec `utm_*` et `kc`, jeton de destinataire forgé → attribution au lien seulement) ; **commande attribuée puis payée → chiffre d'affaires confirmé 20,80 €** ; désinscription en un clic (idempotente, forgée 404, contact `suppressed`, exclusion `source = system`) ; rappels : livré, rebond dur → exclusion + destinataire `bounced`, doublons et identifiants inconnus inoffensifs, plainte.

Captures `docs/captures/phase8-*-{1440,390}.png` : campagnes (19), éditeur (20), vérification (21, état « personne n'est éligible » après la désinscription du parcours), rapport, désinscription.

## 7. Décisions prises pendant la phase

- **Pas de suivi d'ouverture** : métriques = envois, livraisons confirmées, rebonds, clics, désinscriptions, commandes attribuées ; le guide UX le demandait, et c'est plus honnête.
- **Markdown restreint** rendu en tables HTML plutôt qu'un éditeur de blocs : accessible, testable, sans HTML brut (échappement systématique, URLs validées).
- **Éligibilité à l'envoi, jamais depuis l'instantané** : trois instantanés (vérification, programmation, envoi) pour la traçabilité, mais la décision d'envoyer à une personne se prend au lancement.
- **Exception client opt-in par campagne**, avec justification tracée dans l'audit et sur la campagne ; exclue par défaut.
- **Worker avec lots courts** et verrous `SKIP LOCKED` sur campagnes et destinataires : plusieurs workers possibles, reprise après panne, aucun doublon ; `sent` est définitif.
- **Attribution au niveau du lien** (`kc` conservé en session storage, posé sur la commande à la réservation, même organisation seulement) ; aucune résolution d'identité par e-mail ; la mention d'incomplétude est dans l'API et à l'écran.
- **Désinscription = exclusion par adresse** (phase 7), pas un enregistrement de consentement « retiré » : la levée éventuelle reste une décision humaine motivée.
- **Script de test** : le worker tourne pendant les E2E pour que l'envoi soit réel (pas de bouton qui simule).
- Correction de domaine pendant la phase : les schémas de mise à jour partielle sont déclarés sans valeurs par défaut (un `.partial()` d'un champ `.default("")` réinitialisait objet / corps / expéditeur).

## 8. Limites connues

- **Base hébergée (Supabase) toujours non synchronisée** : même état qu'en phases 3–7. Bundle `0000…0008` prêt et vérifié localement.
- **Resend non vérifié en conditions réelles** (réseau sortant fermé) : adaptateur, signature des rappels et contrat documentés, couverts par tests unitaires ; à valider en préproduction avec `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` et `EMAIL_WEBHOOK_SECRET=whsec_…`.
- Latence d'envoi : le worker réclame les campagnes chaque minute (cron pg-boss) ; pas de déclenchement immédiat depuis le web.
- Pas de limitation de débit fournisseur au-delà des lots ; pas de fenêtre d'envoi.
- Attribution perdue si la personne change de navigateur ou vide sa session ; pas d'attribution des adhésions.
- Rapport sans export ; pas de comparaison entre campagnes (phase 9 — analytics).

## 9. Sécurité

Livré : `campaigns.manage` / `campaigns.send` distincts ; références (segment, gabarit) bornées à l'organisation (422), campagnes d'une autre organisation 404, outsider et responsable limité 403 ; **aucun message à une personne non éligible** (assertions sur la boîte de sortie ; désinscription après programmation respectée) ; un message par adresse ; jetons de destinataire et de désinscription dérivés HMAC (jamais stockés, 404 uniforme, forgeries ignorées) ; rappels fournisseur signés sur le corps brut, fournisseur configuré seulement, idempotents ; redirection de lien suivi uniquement vers la cible enregistrée (jamais d'URL ouverte) ; aucune IP stockée ; HTML échappé ; attribution limitée à la même organisation ; une campagne lancée n'est jamais annulée. Tests négatifs : 3 par API directe (S10) + cas 403 / 404 / 409 / 412 / 422 en intégration.

## 10. Dépendances pour la phase 9 (opérations : analytics, tâches, notifications)

- Métriques de campagne prêtes dans `campaign_recipients`, `message_deliveries`, `tracking_events`, `orders.campaign_id` ; `campaign.finished` dans l'outbox pour les notifications internes.
- `notification_preferences` / `notifications` (tables listées par le prompt maître) à créer avec les notifications internes.
- Le contrôle d'accès (phase 9 ou 10) réutilisera `volunteer_attendance` et `checkins` ; les analytics agrégeront commandes, remboursements, frais, bénévolat et campagnes.

## 11. Definition of Done — phase 8

| Critère                                                  | État                                                                                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le code se construit                                     | ✅ 183 routes                                                                                                                                                               |
| Typecheck                                                | ✅ 14/14                                                                                                                                                                    |
| Lint                                                     | ✅                                                                                                                                                                          |
| Migrations sur base vierge                               | ✅ 0000 → 0008, 90 tables, `db:check` ; bundle Supabase rejoué sur base neuve                                                                                               |
| Tests unitaires                                          | ✅ 62/62 (7 marketing)                                                                                                                                                      |
| Tests d'intégration                                      | ✅ 123/123 (11 marketing)                                                                                                                                                   |
| Tests E2E requis                                         | ✅ 70/70 : adhésion consentie → segment → brouillon → test → vérification → envoi réel par le worker → rapport → lien suivi → désinscription sans connexion → contact exclu |
| Tests d'autorisation                                     | ✅ 42/42 par API directe ; outsider, responsable limité, autre organisation, segment étranger, audience sans consentement, note légale, rappels non signés, jetons forgés   |
| Consent-based eligibility                                | ✅ revalidée à l'envoi ; `customer_only` exclu sauf décision tracée                                                                                                         |
| Unsubscribe                                              | ✅ page sans connexion + one-click `List-Unsubscribe-Post` ; exclusion par adresse                                                                                          |
| Duplicate recipient suppression                          | ✅ `UNIQUE (campaign_id, email)` + déduplication au calcul                                                                                                                  |
| Delivery retries                                         | ✅ 3 tentatives par destinataire, reprise sans doublon, `sent` définitif                                                                                                    |
| No marketing to ineligible recipients                    | ✅ assertions sur la boîte de sortie (intégration) et S10                                                                                                                   |
| Attribution with honest disclosure                       | ✅ au niveau du lien, CA confirmé = payé, mention d'incomplétude API + UI                                                                                                   |
| Machine à états typée                                    | ✅ campagne (graphe documenté, transitions gardées)                                                                                                                         |
| Base hébergée à jour                                     | ⏳ migrations prêtes et vérifiées localement ; **Supabase injoignable depuis cet environnement** (§8)                                                                       |
| Fournisseur de production                                | ⏳ adaptateur Resend livré et testé unitairement ; **vérification externe en attente** (§8)                                                                                 |
| Documentation (plan, OpenAPI, ER, architecture, rapport) | ✅                                                                                                                                                                          |
