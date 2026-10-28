# Phase 3 — Billetterie : cadrage

Date : 28 octobre 2026. Précède l'implémentation (§22 du prompt maître).

## 1. Périmètre

Tarifs par événement (gratuits ou payants, quotas, fenêtres de vente, maximum par commande, tarifs masqués, pools de capacité partagés), codes promo, formulaire de commande public avec achat invité, réservation d'inventaire limitée dans le temps (10 min), paiement par prestataire externe (Stripe Connect, compte connecté de l'organisation, commission plateforme = frais acheteur), confirmation par **webhook uniquement**, émission des billets avec identifiant QR opaque et révocable, e-mails de confirmation, liste et détail des commandes, remboursement total ou partiel par billet, contrôle d'accès par scan atomique avec compteurs, journal comptable en partie double. Écrans : 06 (tarifs), 09 (commandes), 10 (détail et remboursement), 28 → 34 (tunnel public), 32 (billet), 41 → 44 (contrôle), + « Mes billets » (45 partiel) et réglages paiements (24 partiel).

Hors périmètre : billets réservés aux adhérents (phase 4), versements / finances (22, phase 7 : le ledger est alimenté dès maintenant), exports comptables (phase 9), file d'attente, revente, sièges numérotés, contrôle hors connexion réel (écran 44 = état d'erreur réseau honnête, pas de mode dégradé avec cache local — décision ci-dessous).

## 2. Existant réutilisé

Événements et capacité (`events.capacity`), RBAC (`tickets.manage`, `orders.read`, `orders.refund`, `checkins.scan` déjà au catalogue), `StateMachine`, `Money` (unités mineures entières), audit, outbox + relais, idempotency_records, e-mail transactionnel (`renderTransactionalEmail`, adaptateurs), `apiRoute`, server actions, `PublicShell`, `CheckInShell` (coque scanner posée en phase 0), `form_*` (questions à la commande : posées, **non utilisées** cette phase — le formulaire public collecte e-mail, prénom, nom et le nom de chaque participant quand les billets sont nominatifs).

Variables d'environnement déjà déclarées en phase 0 : `PAYMENT_PROVIDER` (`stripe` | `fake`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`, `FAKE_PAYMENT_WEBHOOK_SECRET`, `PLATFORM_FEE_BPS` (défaut 400), `PLATFORM_FEE_FIXED_MINOR`.

## 3. Changements de base (migration `0003_ticketing`)

| Table                                                      | Rôle                                                                                                                                                                                                          | Contraintes clés                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticket_types`                                             | tarif d'un événement : nom, description, prix (unités mineures) + devise, quota (null = capacité de l'événement), fenêtre de vente, min/max par commande, masqué, position, statut                            | FK composite `(organization_id, event_id)`, `UNIQUE (organization_id, id)`, `CHECK price >= 0`, `CHECK quota IS NULL OR quota >= 0`, `CHECK sales_end > sales_start` |
| `ticket_inventory_pools`, `ticket_pool_links`              | capacité partagée entre plusieurs tarifs (ex. « salle » 900 partagée entre deux vagues)                                                                                                                       | FK composites, `UNIQUE (pool_id, ticket_type_id)`                                                                                                                    |
| `inventory_holds`, `inventory_hold_items`                  | réservation temporaire liée à une commande, expiration, statut `active` / `consumed` / `released`                                                                                                             | FK composites, index `(status, expires_at)`                                                                                                                          |
| `orders`                                                   | commande : numéro `KR-nnnn` par organisation, acheteur (e-mail, prénom, nom, `user_id` facultatif), montants (sous-total, remise, frais, total), devise, statut, `access_token_hash`, `expires_at`, `version` | `UNIQUE (organization_id, number)`, `UNIQUE (access_token_hash)`, `CHECK total = subtotal - discount + fees`, `CHECK montants >= 0`, FK composite événement          |
| `order_items`                                              | ligne : tarif, quantité, prix unitaire, frais unitaires                                                                                                                                                       | FK composites commande + tarif                                                                                                                                       |
| `tickets`                                                  | un billet par place : numéro `KR-nnnn-01`, participant, statut, `qr_credential_hash` (SHA-256 d'un secret aléatoire 256 bits, jamais stocké en clair), `used_at`, `revoked_at`                                | `UNIQUE (qr_credential_hash)`, `UNIQUE (organization_id, number)`, FK composites commande + tarif + événement                                                        |
| `checkins`                                                 | tentatives de contrôle : billet, résultat (`accepted` / `already_used` / `revoked` / `refunded` / `invalid`), contrôleur, appareil                                                                            | **`UNIQUE (ticket_id) WHERE result = 'accepted'`** (jamais deux entrées acceptées)                                                                                   |
| `promo_codes`, `promo_redemptions`                         | code par événement, remise en % ou montant, plafond d'utilisations, fenêtre ; une utilisation par commande payée                                                                                              | `UNIQUE (event_id, code)`, `UNIQUE (promo_code_id, order_id)`                                                                                                        |
| `payment_accounts`                                         | compte prestataire de l'organisation (Stripe Connect) : id externe, statut d'onboarding, capacités                                                                                                            | `UNIQUE (organization_id, provider)`                                                                                                                                 |
| `payments`, `payment_attempts`                             | paiement d'une commande : fournisseur, références externes (session / intent / charge), montant, commission, statut ; tentatives horodatées                                                                   | `UNIQUE (provider, provider_ref)`, FK composite commande                                                                                                             |
| `payment_webhook_events`                                   | **journal d'idempotence des webhooks** : `UNIQUE (provider, provider_event_id)`, charge utile, `processed_at`, résultat                                                                                       | la contrainte unique est la garantie « aucun double traitement »                                                                                                     |
| `refunds`, `refund_items`                                  | remboursement : montant, motif, statut, référence externe ; lignes = billets remboursés                                                                                                                       | `UNIQUE (refund_id, ticket_id)`, `CHECK amount > 0` ; la somme ≤ montant encaissé est garantie en transaction (verrou sur le paiement)                               |
| `ledger_accounts`, `ledger_transactions`, `ledger_entries` | partie double par organisation : `receivable_provider`, `revenue_tickets`, `platform_fees`, `refunds_payable` ; une transaction = entrées équilibrées                                                         | `CHECK amount <> 0`, l'équilibre (Σ débits = Σ crédits) vérifié à l'écriture                                                                                         |
| `financial_documents`                                      | reçus / justificatifs — posée, non alimentée (phase 7)                                                                                                                                                        |                                                                                                                                                                      |
| `events` (ajout)                                           | `ticketing_status` (`not_configured` / `open` / `closed`), `max_tickets_per_order`, `sales_close_at`, `nominative_tickets`                                                                                    | `CHECK max_tickets_per_order BETWEEN 1 AND 50`                                                                                                                       |

Disponibilité d'un tarif = min(quota du tarif, capacité de chaque pool lié, capacité de l'événement) − (billets non remboursés + places en réservation active). Calculée **sous verrou** (`SELECT … FOR UPDATE` sur les lignes `ticket_types` concernées et sur l'événement) à chaque création de réservation : aucune survente possible par concurrence.

## 4. Machines à états

```
ORDER    draft → reserved (réservation posée) → awaiting_payment (session de paiement créée) → paid (webhook succeeded)
         reserved | awaiting_payment → expired (job : expires_at dépassé, réservation libérée)
         awaiting_payment → failed (webhook failed/cancelled ; la réservation reste jusqu'à expires_at → réessai possible)
         failed → awaiting_payment (nouvelle tentative avant expiration)
         paid → partially_refunded → refunded ; paid → refunded
         gratuit : reserved → paid directement (aucun paiement), billets émis sur-le-champ
PAYMENT  created → pending → succeeded | failed | cancelled ; succeeded → partially_refunded → refunded
TICKET   pending (commande non payée) → valid (émission) → used (scan accepté) ; valid → revoked ; valid | used → refunded
```

Webhooks hors séquence : un événement `succeeded` reçu après `failed` prévaut (la commande passe `paid`) ; un `failed` reçu après `succeeded` est journalisé et ignoré (le paiement est déjà confirmé). Un `succeeded` tardif sur une commande `expired` : la commande est re-réservée si l'inventaire le permet, sinon un remboursement automatique est déclenché et l'acheteur informé — **réconciliation du paiement tardif**.

## 5. Port « fournisseur de paiement »

`packages/payments` : interface `PaymentProviderPort` — `createConnectedAccount` / `accountLink` / `getAccountStatus`, `createCheckoutSession({ order, successUrl, cancelUrl, applicationFee })`, `createRefund`, `parseWebhook(rawBody, signature)` → événement normalisé `{ providerEventId, type, providerRef, amount, occurredAt }`.

- Adaptateur **`stripe`** : SDK officiel, Checkout Session sur le compte connecté (`stripeAccount`), `application_fee_amount` = frais acheteur, vérification de signature `stripe.webhooks.constructEvent`, remboursements `refunds.create` avec `reverse_transfer` + `refund_application_fee`. **Vérification externe en attente** : l'environnement de validation n'a pas d'accès réseau à Stripe ni de clés ; l'adaptateur est couvert par typage et par un test unitaire de la signature (HMAC v1 reconstruit).
- Adaptateur **`fake`** (développement et test uniquement, refusé en staging/production comme l'e-mail `console`) : page de paiement simulée **dans l'application** (`/paiement/[sessionId]`) avec « Payer » / « Refuser », qui envoie au webhook `/api/v1/payments/webhooks/fake` un événement signé HMAC-SHA256 (`FAKE_PAYMENT_WEBHOOK_SECRET`). Le tunnel complet — redirection, webhook, idempotence, désordre, paiement tardif — est ainsi exercé de bout en bout par les tests. Aucune donnée simulée n'entre dans une route de production : l'adaptateur est sélectionné par `PAYMENT_PROVIDER` et verrouillé par `APP_ENV`.

## 6. API et UI

| Méthode        | URL                                                                | Permission                                                                              |
| -------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| GET / POST     | `/organizations/{id}/events/{eventId}/ticket-types`                | `events.read` / `tickets.manage`                                                        |
| PATCH / DELETE | `/organizations/{id}/events/{eventId}/ticket-types/{ticketTypeId}` | `tickets.manage` (DELETE : archivage ; refusé si des billets existent)                  |
| PATCH          | `/organizations/{id}/events/{eventId}/ticketing`                   | `tickets.manage` : ouverture/fermeture des ventes, max par commande, clôture, nominatif |
| GET / POST     | `/organizations/{id}/events/{eventId}/promo-codes`                 | `tickets.manage`                                                                        |
| GET            | `/organizations/{id}/orders?eventId&status&q`                      | `orders.read`                                                                           |
| GET            | `/organizations/{id}/orders/{orderId}`                             | `orders.read`                                                                           |
| POST           | `/organizations/{id}/orders/{orderId}/resend`                      | `orders.read`                                                                           |
| POST           | `/organizations/{id}/orders/{orderId}/refunds`                     | `orders.refund` (body : `ticketIds[]` ou `full`, `reason`)                              |
| GET            | `/organizations/{id}/events/{eventId}/checkins/summary`            | `checkins.scan`                                                                         |
| POST           | `/organizations/{id}/events/{eventId}/checkins`                    | `checkins.scan` (body : `credential`) → `accepted` / `already_used` / …                 |
| GET / POST     | `/organizations/{id}/payment-account` (+ `/onboarding-link`)       | `organization.manage`                                                                   |
| GET            | `/public/organizations/{slug}/events/{eventSlug}/ticket-types`     | anonyme (tarifs visibles + disponibilité)                                               |
| POST           | `/public/orders`                                                   | anonyme : crée commande + réservation (`reserved`), renvoie `accessToken`               |
| GET / PATCH    | `/public/orders/{orderId}` (Bearer accessToken ou `?k=`)           | acheteur : lecture, coordonnées + participants (PATCH tant que non payée)               |
| POST           | `/public/orders/{orderId}/checkout`                                | acheteur : crée la session de paiement → URL ; gratuit → `paid` immédiat                |
| POST           | `/public/orders/{orderId}/promo`                                   | acheteur : applique un code                                                             |
| GET            | `/public/tickets/{ticketToken}`                                    | porteur du lien (jeton de billet ≠ identifiant QR)                                      |
| POST           | `/payments/webhooks/{provider}`                                    | signature du prestataire ; idempotent                                                   |

UI organisateur : `/o/[slug]/evenements/[eventSlug]/billets` (06 : tarifs, pools, codes promo, paramètres de vente, récapitulatif quotas / capacité, ouverture des ventes), `/o/[slug]/billetterie` (09 : indicateurs réels, sélecteur d'événement, commandes avec recherche et filtre, onglet participants, export CSV), `/o/[slug]/billetterie/commandes/[orderId]` (10 : billets, paiement, historique, remboursement total / partiel avec motif), `/o/[slug]/evenements/[eventSlug]/controle` (41–44 : scanner caméra `BarcodeDetector` quand disponible + saisie manuelle, compteur entrées / billets valides, résultats 42/43, erreur réseau 44), `/o/[slug]/parametres` (bloc « Paiements » : connecter / état du compte). Pilotage (08) : indicateurs billets vendus / recettes réels, lien vers tarifs et contrôle.

UI public : `/[orgSlug]/[eventSlug]` (CTA billets actif quand les ventes sont ouvertes), `/[orgSlug]/[eventSlug]/billets` (28 : quantités, disponibilité, récapitulatif, frais annoncés), `/commande/[orderId]` (29 : coordonnées + participants, minuteur), `/commande/[orderId]/paiement` → prestataire, `/commande/[orderId]/confirmation` (31 : **interroge l'état de la commande** jusqu'au webhook — jamais d'émission sur la seule redirection ; 33 refus avec réessai ; 34 expiration), `/billets/[ticketToken]` (32 : QR, téléchargement différé), `/moi/billets` (commandes rattachées au compte ou à l'adresse vérifiée).

E-mails : confirmation de commande (lien commande + billets), paiement refusé (lien de réessai), remboursement effectué.

Jobs worker : `orders.expire-holds` (chaque minute : commandes `reserved` / `awaiting_payment` / `failed` expirées → `expired`, réservation libérée), `payments.reconcile` (toutes les 10 min : paiements `pending` depuis > 15 min → interroge le prestataire).

## 7. Sécurité

- **Jamais d'émission sur redirection** : la page de confirmation lit l'état ; seul le webhook (signature vérifiée) ou le cas gratuit fait passer `paid`.
- **Idempotence** : `payment_webhook_events UNIQUE (provider, provider_event_id)` ; traitement dans une transaction avec verrou `FOR UPDATE` sur la commande ; un second envoi renvoie 200 sans effet.
- **Pas de survente** : réservation sous verrou de lignes, disponibilité recalculée, expiration par job ; les billets ne sont émis qu'à partir d'une commande `paid`.
- **QR** : identifiant opaque aléatoire (256 bits, base64url), **haché** en base, montré une fois au porteur du billet, révocable ; le lien du billet utilise un second jeton (lecture) distinct de l'identifiant QR (scan). Aucune donnée personnelle dans le QR.
- **Scan atomique** : `UPDATE tickets SET status = 'used' … WHERE id = $1 AND status = 'valid' RETURNING` + unique partiel sur `checkins` ; réponse différenciée (`already_used` avec premier passage et contrôleur).
- **Accès acheteur** : `access_token` 256 bits haché, transmis par lien (e-mail) ; expiration de l'accès 30 jours après l'événement ; aucune énumération possible (404 uniforme).
- **Tenant** : chaque table porte `organization_id` + FK composites ; aucune commande / billet / remboursement joignable hors organisation ; le scanner n'accepte que les billets de **son** événement.
- **Remboursements** : montant ≤ encaissé − déjà remboursé (verrou sur le paiement), motif obligatoire, audit, statut `pending` jusqu'au webhook de remboursement.
- **Logs** : jamais de secret de paiement, d'identifiant QR, de numéro de carte (la carte n'est jamais saisie dans Kroov : page hébergée du prestataire).
- Tests négatifs : B lit / rembourse une commande de A (404/403) ; scan d'un billet d'un autre événement (`invalid`) ; webhook sans signature (400) ; webhook rejoué (200, aucune double émission) ; `paid` impossible via PATCH ; sur-réservation concurrente (10 réservations parallèles sur 3 places → 3 réussissent).

## 8. Tests attendus

Unit : machines à états (3), calcul des frais / remises / totaux, disponibilité, signature HMAC fake + reconstruction de signature Stripe.
Intégration : création tarifs, quotas vs capacité, réservation (disponibilité, verrous, concurrence), expiration, gratuit → payé immédiat, checkout → webhook succeeded → billets émis + e-mail + ledger équilibré, webhook dupliqué, webhook `failed` puis `succeeded`, `succeeded` tardif sur commande expirée (re-réservation ou remboursement), remboursement partiel puis total (plafond), scan accepté / doublon / révoqué / autre événement, codes promo (plafond, fenêtre), isolation tenant.
Sécurité (API directe) : liste ci-dessus.
E2E : configurer les tarifs → ouvrir les ventes → page publique → choisir 2 billets → coordonnées → payer (fournisseur simulé) → confirmation → billet avec QR → scanner accepté → second scan refusé → remboursement d'un billet → billet refusé au scan ; refus de paiement → réessai ; expiration de la réservation.

## 9. Hypothèses (non bloquantes, décidées)

1. **Frais acheteur = commission plateforme** (`PLATFORM_FEE_BPS` 4 % + fixe), affichés avant paiement, encaissés via `application_fee_amount`. Billets gratuits : aucun frais, aucun paiement.
2. Devise de l'organisation : `EUR` par défaut (réglage `organization_settings.currency` ajouté, CHF accepté — Suisse romande).
3. Réservation : 10 minutes, prolongée à 10 minutes à la création de la session de paiement (la page de paiement hébergée a son propre délai).
4. Contrôle hors connexion : l'écran 44 est un état d'erreur réseau honnête (aucune entrée enregistrée) ; un mode dégradé avec cache local des billets est reporté (risque de double entrée) et documenté.
5. Numérotation `KR-1000` + compteur par organisation ; billets `KR-1000-01`.
6. Stripe : vérification externe **en attente** (pas de clés, pas de réseau) ; onboarding Express via Account Links ; la page `/o/[slug]/parametres` affiche l'état réel du compte et, en fournisseur simulé, une connexion instantanée explicitement libellée « simulée ».
