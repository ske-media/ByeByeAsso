# Rapport de phase 3 — Billetterie

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-3-plan.md`.

## 1. Périmètre livré

Tarifs par événement (gratuits ou payants, quotas, fenêtres de vente, min/max par commande, masqués, pools de capacité partagée), codes promo (pourcentage ou montant, plafond, validité), paramètres de vente (ouverture/fermeture, maximum par commande, clôture, billets nominatifs), tunnel public avec achat invité (choix → coordonnées et participants → paiement hébergé → confirmation par webhook), réservation d'inventaire 10 minutes sous verrous (aucune survente), paiement via port prestataire (Stripe Connect réel + fournisseur simulé pour dev/test), **émission des billets uniquement par webhook signé ou commande gratuite**, identifiants QR dérivés (jamais stockés), e-mails de confirmation / refus / remboursement, liste et détail des commandes avec export CSV, remboursement total ou partiel plafonné, contrôle d'accès avec scan atomique (caméra + saisie), réconciliation des paiements tardifs et doublons, ledger en partie double, jobs d'expiration et de réconciliation. Écrans : 06, 09, 10, 24 (paiements), 28, 29, 31, 32, 33, 34, 41, 42, 43, 44, « Mes billets ».

Hors périmètre, comme cadré : billets réservés aux adhérents (phase 4), versements/finances (phase 7 — le ledger est alimenté), exports comptables (phase 9), contrôle hors connexion réel (l'écran 44 est un état d'erreur réseau honnête), téléchargement PDF des billets (page HTML + QR, documenté ci-dessous).

## 2. Fichiers créés ou modifiés

| Zone                | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database` | `schema/ticketing.ts` (21 tables), `events` + 4 colonnes de billetterie, migration `0003_ticketing.sql`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/domain`   | `payments/port.ts` (port prestataire), `ticketing/` : `schemas`, `state-machines` (commande, paiement, billet), `pricing`, `ticket-types` (tarifs, pools, promo, réglages, disponibilité), `orders` (réservation sous verrous, coordonnées, promo, checkout, `markOrderPaid`, expiration, lectures, renvoi), `payments` (comptes connectés, webhooks, réconciliation), `refunds`, `checkins`, `ledger`, `emails`, `context` (HMAC) — 3 834 lignes ; `orders/` et `payments/` réexportent                                |
| `packages/payments` | `fake.ts` (fournisseur simulé, HMAC-SHA256), `stripe.ts` (SDK `stripe@23.0.1`, Connect Express), fabrique avec garde `APP_ENV`, tests                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/config`   | slugs réservés `commande`, `paiement`, `billet`, `invitation`, `o`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/ui`       | `CheckInShell` : navigation à largeur dynamique                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/web`          | `lib/ticketing.ts` (singleton prestataire, contexte), `lib/money.ts`, `actions/ticketing.ts`, 20 routes `/api/v1/*`, pages organisateur (`…/billets`, `/billetterie`, `/billetterie/commandes/[orderId]`, export CSV, bloc paiements des réglages, bloc billetterie du pilotage, nav « Billetterie »), scanner `/controle/[slug]/[eventSlug]`, tunnel public (`…/billets`, `/commande/[orderId]`, `…/confirmation`, `/billets/[viewToken]`, `/paiement/[sessionId]`), `/moi/billets`, CTA billets sur la page événement |
| `apps/worker`       | `jobs/ticketing.ts` : `orders.expire-holds` (minute), `payments.reconcile` (10 min)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tests`             | intégration `ticketing/ticketing.test.ts` (17 cas), unit `payments/providers.test.ts` (3), sécurité S5 (5 cas), E2E `ticketing.e2e.ts` (5 parcours × 2 viewports)                                                                                                                                                                                                                                                                                                                                                       |
| `docs`              | `phase-3-plan.md`, `openapi.yaml` (44 chemins, 34 schémas), `er-diagram.md`, `architecture.md` (§6, §7, §7quater), captures `phase3-*`                                                                                                                                                                                                                                                                                                                                                                                  |

## 3. Migrations

`0003_ticketing.sql` : 21 tables, 12 enums, 32 index (17 uniques dont le partiel `checkins_accepted_once_uq` et `payment_webhook_events_uq`), 27 `CHECK` (totaux cohérents, montants ≥ 0, remboursé ≤ encaissé, e-mail en minuscules…), 52 FK dont 30 composites tenant-safe. Appliquée sur base vierge (`db:reset` : 50 tables dans `public`), `db:check` cohérent.

## 4. API livrée

| Méthode             | URL                                                            | Permission / règle                                                                  |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET / POST          | `/organizations/{id}/events/{eventId}/ticket-types`            | `events.read` / `tickets.manage`                                                    |
| PATCH / DELETE      | `…/ticket-types/{ticketTypeId}`                                | `tickets.manage` ; archivage refusé (412) avec réservations en cours                |
| GET / PATCH         | `…/events/{eventId}/ticketing`                                 | `events.read` / `tickets.manage` ; ouverture 412 sans tarif ou événement non publié |
| GET / POST / DELETE | `…/events/{eventId}/pools[/{poolId}]`                          | `events.read` / `tickets.manage`                                                    |
| GET / POST / PATCH  | `…/events/{eventId}/promo-codes[/{promoCodeId}]`               | `tickets.manage`                                                                    |
| GET                 | `/organizations/{id}/orders?eventId&status&q`                  | `orders.read` (périmètre événement) + indicateurs                                   |
| GET                 | `/organizations/{id}/orders/{orderId}`                         | `orders.read` ; 404 hors périmètre                                                  |
| POST                | `/organizations/{id}/orders/{orderId}/refunds`                 | `orders.refund` ; plafond encaissé − remboursé ; motif obligatoire                  |
| POST                | `/organizations/{id}/orders/{orderId}/resend`                  | `orders.read` ; rotation des jetons                                                 |
| POST                | `/organizations/{id}/events/{eventId}/checkins` (+ `/summary`) | `checkins.scan` sur l'événement ; admission atomique                                |
| GET / POST          | `/organizations/{id}/payment-account` (+ `/onboarding-link`)   | `organization.manage`                                                               |
| GET                 | `/public/organizations/{slug}/events/{eventSlug}/ticket-types` | anonyme, disponibilité en direct, `no-store`                                        |
| POST                | `/public/orders`                                               | anonyme : réservation sous verrous, `accessToken` renvoyé une seule fois            |
| GET / PATCH         | `/public/orders/{orderId}` (`?k=` ou Bearer)                   | acheteur ; 404 uniforme ; `status` non modifiable                                   |
| POST                | `/public/orders/{orderId}/checkout` · `/promo`                 | acheteur ; gratuit → payé immédiat ; sinon session hébergée                         |
| GET                 | `/public/tickets/{viewToken}`                                  | porteur du lien ; `qrCredential` seulement si valide/utilisé                        |
| POST                | `/payments/webhooks/{provider}`                                | signature sur le corps brut ; idempotent ; 400 / 404 / 500 (retry)                  |
| GET / POST          | `/payments/fake/{sessionId}`                                   | fournisseur simulé uniquement (404 ailleurs)                                        |

## 5. Routes UI livrées

Organisateur : `/o/[slug]/evenements/[eventSlug]/billets` (06 : tarifs avec compteurs vendus · réservés · restants, dialogue de création/modification, archivage confirmé, pools, codes promo, paramètres de vente, ouverture/fermeture avec raisons de blocage, récapitulatif quotas vs capacité et frais acheteur réels), `/o/[slug]/billetterie` (09 : indicateurs réels, sélecteur d'événement, recherche, filtre statut, onglets commandes / participants, export CSV), `/o/[slug]/billetterie/commandes/[orderId]` (10 : billets, paiement, historique, remboursement total ou par billets avec motif et confirmation, renvoi des billets), `/o/[slug]/parametres` (bloc paiements : connexion, état du compte, resynchronisation ; mention explicite « simulé » en dev/test), pilotage (08 : billets payés, recettes, en attente, liens billets / commandes / contrôle), nav « Billetterie ». Contrôle : `/controle/[slug]/[eventSlug]` (41 : caméra `BarcodeDetector` + saisie manuelle, compteur ; 42 accepté ; 43 déjà passé avec premier passage et contrôleur ; 44 erreur réseau ; journal).

Public : page événement (CTA « Choisir mes billets » quand les ventes sont ouvertes, « à partir de »), `/[orgSlug]/[eventSlug]/billets` (28 : quantités, restants, frais annoncés, total, 10 min), `/commande/[orderId]` (29 : coordonnées, participants nominatifs, promo, minuteur ; 33 : refus avec réessai ; 34 : réservation expirée), `/paiement/[sessionId]` (page du prestataire simulé), `/commande/[orderId]/confirmation` (31 : attente du webhook puis billets ; état remboursé), `/billets/[viewToken]` (32 : QR SVG, code manuel, suivant), `/moi/billets`. Aucun bouton factice : pas de « Télécharger le PDF » tant qu'il n'existe pas, le CTA billetterie n'apparaît que si les ventes sont ouvertes.

## 6. Commandes exécutées et résultats réels

```
$ pnpm lint                              → exit 0   Checked 324 files. No fixes applied.
$ pnpm typecheck                         → exit 0   Tasks: 14 successful, 14 total
$ pnpm db:check                          → exit 0   Everything's fine
$ DATABASE_URL=…kroov_test pnpm db:reset → exit 0   Base réinitialisée et migrée. (0000 → 0003, 50 tables)
$ pnpm test:unit                         → exit 0   7 fichiers · 33 tests (dont fournisseurs : fabrique, HMAC fake, signature Stripe t=/v1= + rejeu)
$ pnpm test:integration                  → exit 0   6 fichiers · 70 tests (8 infra + 24 identité + 21 événements + 17 billetterie)
$ pnpm test:security (statique)          → exit 0   1 test, 21 ignorés sans serveur (voulu)
$ pnpm secrets:scan                      → exit 0   337 fichiers, 0 finding
$ pnpm build                             → exit 0   Next.js compilé, 85 routes ; worker OK
$ scripts/test-server.sh start           → server up (APP_ENV=test, EMAIL_PROVIDER=file, PAYMENT_PROVIDER=fake)
$ E2E_BASE_URL=… pnpm test:security      → exit 0   2 fichiers · 22 tests (17 phases 1–2 + 5 phase 3)
$ E2E_BASE_URL=… pnpm test:e2e           → exit 0   36 passed (18 desktop-1440 + 18 mobile-390)
$ timeout 25 tsx apps/worker/src/main.ts → démarre ; files pgboss : orders.expire-holds, payments.reconcile, events.complete-ended, outbox.relay, maintenance.*
```

Cas d'intégration notables (réellement exécutés) : 10 acheteurs concurrents pour 3 places → 3 réservations, 7 refus `insufficient_inventory` ; pool partagé respecté ; webhook `failed` puis `succeeded` → commande payée ; webhook dupliqué → `duplicate` sans double émission ; `failed` après `succeeded` → `ignored_out_of_order` ; signature invalide rejetée ; paiement tardif avec places → re-réservation et émission ; paiement tardif sans places → `refunded_late_payment` + e-mail ; paiement en double sur commande payée → remboursement automatique ; 4 scans simultanés du même billet → exactement 1 accepté ; remboursement partiel puis total, second remboursement du même billet refusé ; ledger : Σ des comptes = 0.

Captures `docs/captures/phase3-*-{1440,390}.png` : configuration des billets, commandes, commande, paiements (réglages), choix des billets, confirmation, billet, contrôle.

## 7. Décisions prises pendant la phase

- **Fournisseur simulé** (`PAYMENT_PROVIDER=fake`) : page de paiement hébergée _dans l'application_ + webhook HMAC signé livré par HTTP à notre propre endpoint. Le tunnel, l'idempotence, le désordre et les paiements tardifs sont exercés de bout en bout ; la fabrique refuse ce fournisseur en staging/production. **Vérification externe Stripe en attente** (pas de clés ni de réseau) : l'adaptateur réel est écrit avec le SDK officiel et couvert par le test de signature.
- **Billets créés dès la réservation en `pending`** (noms de participants, numéros stables), validés au paiement, révoqués à l'expiration ; un paiement tardif ré-émet des billets neufs. Les compteurs de disponibilité n'incluent que `valid`/`used` + réservations actives.
- **Secrets dérivés, jamais stockés** : jeton commande, jeton page billet et identifiant QR = HMAC(`AUTH_SECRET`, scope:id:version) ; la base ne garde que des SHA-256. Le renvoi des billets incrémente `secret_version` : les anciens liens meurent.
- **Verrou organisation → événement** à chaque réservation (numérotation `KR-1000+n` race-free et disponibilité exacte) ; débit suffisant pour le MVP, documenté pour la phase 10 (séquence dédiée si besoin).
- **Paiement en double** (deux sessions ouvertes, deux succès) : la seconde est remboursée automatiquement ; audit `payment.duplicate_detected`.
- **Coque organisateur** : les réservations abandonnées sans coordonnées (e-mail de substitution `pending+…@kroov.invalid`) sont exclues de la liste des commandes.
- **Scanner** : dédoublonnage 4 s uniquement pour la caméra (le même QR reste dans le cadre) ; la saisie manuelle passe toujours (bug trouvé par l'E2E).
- Frais acheteur = commission plateforme (`PLATFORM_FEE_BPS` 4 % + fixe), prélevés via `application_fee_amount`, remboursés avec le billet (`refund_application_fee`).

## 8. Limites connues

- **Stripe non vérifié en conditions réelles** : création de compte Express, Account Links, Checkout Session, webhooks Connect et remboursements suivent la référence API mais n'ont pas été exécutés contre Stripe. À faire dès l'obtention de clés de test (checklist en phase 10).
- Le fournisseur simulé garde ses sessions en mémoire du processus web : la réconciliation worker renvoie `pending` pour lui ; l'expiration prend le relais.
- Pas de téléchargement PDF du billet (page HTML + QR, code manuel affiché) ; pas d'Apple/Google Wallet.
- Contrôle hors connexion : non livré (écran 44 = erreur réseau honnête, aucune entrée enregistrée).
- `suspended` (commande/paiement par la plateforme) sans action UI ; `financial_documents` posée, non alimentée.
- Formulaires personnalisés à la commande (`form_*`) non branchés : le tunnel collecte e-mail, prénom, nom et participants.
- Limite de débit applicative sur `/public/orders` et `/payments/webhooks` : celle de l'hébergeur uniquement (phase 10).
- Docker Compose toujours non exécuté dans l'environnement de validation.

## 9. Sécurité

Livré : jamais d'émission sur redirection (confirmation par webhook signé sur le corps brut, idempotence `UNIQUE (provider, provider_event_id)`, traitement sous verrou) ; inventaire sous verrous de lignes ; `UPDATE … WHERE status = 'valid'` + unique partiel pour le scan ; identifiants QR et liens dérivés, hachés, révocables ; jeton acheteur renvoyé une fois, 404 uniforme ; aucun `organizationId`/`version`/hash dans les réponses publiques ; `status` non modifiable par PATCH ; remboursements plafonnés sous verrou du paiement ; FK composites sur toutes les tables ; routes publiques en `no-store` ; page de paiement simulée et endpoint `fake` en 404 hors dev/test ; aucune donnée bancaire ne transite par Kroov ; logs sans secrets. Tests négatifs : 5 par API directe (outsider 403/404, manager limité 404/403, webhook forgé/non signé 400, rejeu no-op, scan inter-événements `invalid`, remboursement refusé/plafonné) + 17 en intégration.

## 10. Dépendances pour la phase 4 (adhésions)

- `ticket_types` pourra porter une éligibilité adhérent (`member_only`) ; la visibilité `private` des événements est déjà respectée côté public.
- Le port prestataire et `processProviderEvent` sont réutilisables pour les cotisations (sessions hébergées sur le compte connecté) ; prévoir un `aggregateType` « membership » dans les webhooks.
- `orders.user_id` et `/moi/billets` posent la base du compte participant (« Mes adhésions » à côté).
- Outbox `order.paid` / `order.refunded` disponibles pour le CRM (phase 7) et le marketing (phase 8).

## 11. Definition of Done — phase 3

| Critère                                                  | État                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Le code se construit                                     | ✅                                                                                                                        |
| Typecheck                                                | ✅ 14/14                                                                                                                  |
| Lint                                                     | ✅                                                                                                                        |
| Migrations sur base vierge                               | ✅ 0000 → 0003, `db:check`                                                                                                |
| Tests d'intégration                                      | ✅ 70/70                                                                                                                  |
| Tests E2E requis                                         | ✅ 36/36 : configurer → ouvrir → acheter (refus, réessai, succès) → billet QR → scan accepté/doublon → remboursement      |
| Tests d'autorisation                                     | ✅ 22/22 par API directe ; outsider, manager limité, scanner inter-événements                                             |
| Pas de survente                                          | ✅ 10 acheteurs concurrents / 3 places (intégration)                                                                      |
| Pas de billet valide sans commande payée                 | ✅ redirection seule sans effet ; webhook forgé 400 ; `status` non patchable                                              |
| Webhooks dupliqués / désordonnés / tardifs               | ✅ duplicate · ignored_out_of_order · re-réservation ou remboursement automatique                                         |
| Pas de double scan accepté                               | ✅ atomique + unique partiel ; 4 scans parallèles → 1 accepté                                                             |
| Remboursements ≤ encaissé                                | ✅ plafond sous verrou, second remboursement refusé                                                                       |
| Machines à états typées                                  | ✅ commande, paiement, billet                                                                                             |
| Intégration externe                                      | ⏳ Stripe : implémenté, signature testée, **vérification externe en attente** ; fournisseur simulé exercé de bout en bout |
| Documentation (plan, OpenAPI, ER, architecture, rapport) | ✅                                                                                                                        |
