# Diagramme entité-relation

Mis à jour à chaque phase. Phase 0 : INFRASTRUCTURE · Phase 1 : AUTH (Better Auth) + IDENTITY · Phase 2 : EVENTS (lieux, événements, réglages, fichiers/médias, formulaires dynamiques — posés, servis par les phases 5 et 9) · Phase 3 : TICKETING (tarifs, pools, réservations, commandes, billets, contrôles, codes promo) + PAYMENTS (comptes connectés, paiements, webhooks, remboursements, ledger en partie double, documents financiers posés).

```mermaid
erDiagram
  users ||--|| user_profiles : "1:1"
  users ||--o{ sessions : has
  users ||--o{ accounts : has
  users ||--o{ organizations : created
  users ||--o{ organization_members : "is member"
  organizations ||--|| organization_settings : "1:1"
  organizations ||--o{ event_locations : owns
  organizations ||--o{ events : owns
  events ||--|| event_settings : "1:1"
  event_locations |o--o{ events : "hosted at (same org)"
  events ||--o{ member_role_assignments : "scopes (same org)"
  events ||--o{ organization_invitations : "scopes (same org)"
  events ||--o{ event_media : has
  stored_files ||--o{ event_media : "is"
  organizations ||--o{ stored_files : owns
  events ||--o{ ticket_types : "sells (same org)"
  events ||--o{ ticket_inventory_pools : "shares (same org)"
  ticket_inventory_pools ||--o{ ticket_pool_links : groups
  ticket_types ||--o{ ticket_pool_links : "belongs to"
  events ||--o{ orders : "ordered for (same org)"
  orders ||--o{ order_items : has
  ticket_types ||--o{ order_items : "priced as"
  orders ||--o| inventory_holds : reserves
  inventory_holds ||--o{ inventory_hold_items : has
  orders ||--o{ tickets : issues
  ticket_types ||--o{ tickets : "typed as"
  tickets ||--o{ checkins : "scanned"
  users ||--o{ checkins : "scanned by"
  events ||--o{ promo_codes : "offers"
  promo_codes ||--o{ promo_redemptions : "used by"
  orders ||--o| promo_redemptions : "applies"
  organizations ||--o{ payment_accounts : "connected at"
  orders ||--o{ payments : "paid by"
  organizations ||--o{ membership_plans : offers
  membership_plans ||--o{ membership_plan_benefits : lists
  membership_plans ||--o{ membership_applications : "applied to"
  membership_applications ||--o| memberships : "becomes"
  membership_plans ||--o{ memberships : "subscribed as"
  memberships ||--o| memberships : "renewed_from"
  memberships ||--o{ membership_entitlements : grants
  memberships ||--o{ membership_validity_changes : "history (append-only)"
  memberships ||--o{ payments : "cotisation paid by"
  users |o--o{ memberships : "attached to (optional)"
  payments ||--o{ payment_attempts : "attempted"
  orders ||--o{ refunds : "refunded by"
  payments ||--o{ refunds : "reverses"
  refunds ||--o{ refund_items : "covers"
  tickets ||--o{ refund_items : "refunded"
  organizations ||--o{ ledger_accounts : "books"
  ledger_transactions ||--o{ ledger_entries : "balances to zero"
  ledger_accounts ||--o{ ledger_entries : "posted to"
  orders ||--o{ ledger_transactions : "explains"
  events ||--o{ form_definitions : "has (same org)"
  form_definitions ||--o{ form_fields : has
  form_definitions ||--o{ form_submissions : receives
  form_submissions ||--o{ form_answers : has
  form_fields ||--o{ form_answers : "answered by"
  organizations ||--o{ organization_members : has
  organizations ||--o{ organization_invitations : has
  organizations ||--o{ roles : "custom (future)"
  organizations ||--o{ audit_logs : scopes
  organizations ||--o{ outbox_events : scopes
  organizations ||--o{ job_executions : scopes
  organizations ||--o{ feature_flags : overrides
  organization_members ||--o{ member_role_assignments : "has (composite FK org+member)"
  roles ||--o{ member_role_assignments : grants
  roles ||--o{ role_permissions : has
  permissions ||--o{ role_permissions : in
  roles ||--o{ organization_invitations : "invited as"

  users {
    uuid id PK
    text name
    text email UK
    boolean email_verified
    timestamptz created_at
  }
  user_profiles {
    uuid user_id PK_FK
    text locale
    text timezone
    text phone
  }
  organizations {
    uuid id PK
    text name
    text slug UK
    organization_legal_form legal_form
    char2 country
    text timezone
    organization_status status
    uuid created_by FK
  }
  organization_settings {
    uuid organization_id PK_FK
    char3 currency
    text locale
    text contact_email
    text website
  }
  organization_members {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    member_status status
    timestamptz joined_at
    timestamptz removed_at
    uuid removed_by FK
  }
  roles {
    uuid id PK
    uuid organization_id FK "NULL = système"
    text key
    text name
    boolean is_system
  }
  permissions {
    uuid id PK
    text key UK
    text description
  }
  role_permissions {
    uuid role_id PK_FK
    uuid permission_id PK_FK
  }
  member_role_assignments {
    uuid id PK
    uuid organization_id FK
    uuid member_id FK
    uuid role_id FK
    uuid event_id "FK en phase 2"
    uuid granted_by FK
  }
  organization_invitations {
    uuid id PK
    uuid organization_id FK
    text email
    uuid role_id FK
    uuid event_id
    text token_hash UK
    invitation_status status
    uuid invited_by FK
    timestamptz expires_at
    timestamptz accepted_at
    uuid accepted_by FK
  }
  audit_logs {
    uuid id PK
    uuid organization_id FK
    text actor_kind
    text actor_id
    text action
    text target_type
    text target_id
    text reason
    jsonb metadata
  }
  event_locations {
    uuid id PK
    uuid organization_id FK
    text name
    text address_line1
    text postal_code
    text city
    text country
    text access_notes
    timestamptz archived_at
  }
  events {
    uuid id PK
    uuid organization_id FK
    text slug
    text title
    text tagline
    text description
    timestamptz starts_at
    timestamptz ends_at
    timestamptz doors_at
    text timezone
    integer capacity
    event_status status
    event_visibility visibility
    uuid location_id FK
    integer version
    timestamptz published_at
    timestamptz cancelled_at
    text cancellation_reason
    timestamptz completed_at
    timestamptz archived_at
    uuid created_by FK
  }
  event_settings {
    uuid event_id PK
    uuid organization_id FK
    text access_info
    text programme
    text contact_email
    text external_url
    boolean show_remaining_capacity
  }
  stored_files {
    uuid id PK
    uuid organization_id FK
    text bucket
    text object_key
    text mime_type
    bigint size_bytes
    uuid uploaded_by FK
  }
  event_media {
    uuid id PK
    uuid organization_id FK
    uuid event_id FK
    uuid file_id FK
    text role
  }
  form_definitions {
    uuid id PK
    uuid organization_id FK
    uuid event_id FK
    text purpose
    text title
    integer version
  }
  form_fields {
    uuid id PK
    uuid organization_id FK
    uuid form_id FK
    text key
    text label
    text type
    boolean required
    integer position
  }
  form_submissions {
    uuid id PK
    uuid organization_id FK
    uuid form_id FK
    text subject_type
    uuid subject_id
    uuid submitted_by FK
  }
  form_answers {
    uuid id PK
    uuid submission_id FK
    uuid field_id FK
    jsonb value
  }
  ticket_types {
    uuid id PK
    uuid organization_id FK
    uuid event_id FK
    text name
    integer price_minor
    char currency
    integer quota
    timestamptz sales_start_at
    timestamptz sales_end_at
    integer min_per_order
    integer max_per_order
    boolean hidden
    ticket_type_status status
  }
  ticket_inventory_pools {
    uuid id PK
    uuid organization_id FK
    uuid event_id FK
    text name
    integer capacity
  }
  ticket_pool_links {
    uuid id PK
    uuid pool_id FK
    uuid ticket_type_id FK
  }
  orders {
    uuid id PK
    uuid organization_id FK
    uuid event_id FK
    text number
    order_status status
    text buyer_email
    uuid user_id FK
    integer subtotal_minor
    integer discount_minor
    integer fees_minor
    integer total_minor
    uuid promo_code_id FK
    text access_token_hash
    integer secret_version
    timestamptz expires_at
    timestamptz paid_at
    integer version
  }
  order_items {
    uuid id PK
    uuid order_id FK
    uuid ticket_type_id FK
    text label
    integer quantity
    integer unit_price_minor
    integer unit_fee_minor
  }
  inventory_holds {
    uuid id PK
    uuid order_id FK
    uuid event_id FK
    inventory_hold_status status
    timestamptz expires_at
  }
  inventory_hold_items {
    uuid id PK
    uuid hold_id FK
    uuid ticket_type_id FK
    integer quantity
  }
  tickets {
    uuid id PK
    uuid organization_id FK
    uuid event_id FK
    uuid order_id FK
    uuid ticket_type_id FK
    text number
    text attendee_name
    ticket_status status
    text qr_credential_hash
    text view_token_hash
    integer secret_version
    timestamptz used_at
  }
  checkins {
    uuid id PK
    uuid event_id FK
    uuid ticket_id FK
    checkin_result result
    uuid scanned_by FK
    timestamptz scanned_at
  }
  promo_codes {
    uuid id PK
    uuid event_id FK
    text code
    promo_discount_kind kind
    integer value
    integer max_redemptions
    boolean active
  }
  promo_redemptions {
    uuid id PK
    uuid promo_code_id FK
    uuid order_id FK
    integer discount_minor
  }
  payment_accounts {
    uuid id PK
    uuid organization_id FK
    payment_provider provider
    text provider_account_id
    payment_account_status status
    boolean charges_enabled
    boolean payouts_enabled
  }
  payments {
    uuid id PK
    uuid order_id FK "nullable"
    uuid membership_id FK "nullable"
    payment_provider provider
    text provider_ref
    text provider_charge_ref
    payment_status status
    integer amount_minor
    integer application_fee_minor
    integer refunded_minor
    text method_label
  }
  payment_attempts {
    uuid id PK
    uuid payment_id FK
    payment_status status
    text provider_event_id
  }
  payment_webhook_events {
    uuid id PK
    payment_provider provider
    text provider_event_id
    text type
    jsonb payload
    timestamptz processed_at
    text outcome
  }
  refunds {
    uuid id PK
    uuid order_id FK
    uuid payment_id FK
    integer amount_minor
    text reason
    refund_status status
    text provider_ref
  }
  refund_items {
    uuid id PK
    uuid refund_id FK
    uuid ticket_id FK
    integer amount_minor
  }
  ledger_accounts {
    uuid id PK
    uuid organization_id FK
    ledger_account_kind kind
    char currency
  }
  ledger_transactions {
    uuid id PK
    uuid organization_id FK
    text kind
    uuid order_id FK
    text reference
  }
  ledger_entries {
    uuid id PK
    uuid transaction_id FK
    uuid account_id FK
    bigint amount_minor
  }
  financial_documents {
    uuid id PK
    uuid organization_id FK
    text kind
    text reference
    uuid order_id FK
  }
  membership_plans {
    uuid id PK
    uuid organization_id FK
    text slug
    text name
    integer price_minor
    text currency
    membership_period_kind period_kind
    timestamptz valid_from
    timestamptz valid_until
    integer duration_months
    boolean requires_review
    integer max_members
    boolean public
    integer position
    membership_plan_status status
  }
  membership_plan_benefits {
    uuid id PK
    uuid organization_id FK
    uuid plan_id FK
    text label
    integer position
  }
  membership_applications {
    uuid id PK
    uuid organization_id FK
    uuid plan_id FK
    text email
    text first_name
    text last_name
    uuid user_id FK
    boolean marketing_opt_in
    membership_application_status status
    text rejection_reason
    timestamptz reviewed_at
  }
  memberships {
    uuid id PK
    uuid organization_id FK
    uuid plan_id FK
    uuid application_id FK
    text number "M-0001 par organisation"
    text member_email
    text member_first_name
    text member_last_name
    uuid user_id FK
    membership_status status
    timestamptz valid_from
    timestamptz valid_until
    uuid renewed_from FK
    integer price_minor
    text currency
    text access_token_hash
    integer secret_version
    timestamptz activated_at
    timestamptz suspended_at
    timestamptz expired_at
    timestamptz cancelled_at
    text cancellation_reason
    timestamptz reminder_sent_at
    integer version
  }
  membership_entitlements {
    uuid id PK
    uuid organization_id FK
    uuid membership_id FK
    text kind
    text key
    timestamptz valid_from
    timestamptz valid_until
  }
  membership_validity_changes {
    uuid id PK
    uuid organization_id FK
    uuid membership_id FK
    text kind
    timestamptz previous_valid_until
    timestamptz new_valid_from
    timestamptz new_valid_until
    text reason
    text actor
    timestamptz created_at
  }
  outbox_events {
    uuid id PK
    text aggregate_type
    text event_type
    jsonb payload
    uuid organization_id FK
    outbox_status status
  }
  job_executions {
    uuid id PK
    text queue
    text job_id
    job_execution_status status
    uuid organization_id FK
  }
  feature_flags {
    uuid id PK
    text key
    boolean enabled
    uuid organization_id FK
  }
  idempotency_records {
    uuid id PK
    text scope
    text key
    text request_hash
    jsonb response
    timestamptz expires_at
  }
```

## Contraintes d'intégrité notables

| Table                                                 | Contrainte                                                                                                                                                                                                                                  | Invariant garanti                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `users`                                               | `UNIQUE (email)`                                                                                                                                                                                                                            | une identité par adresse                                                                            |
| `organizations`                                       | `UNIQUE (slug)`, `CHECK slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'`, `CHECK char_length(name) BETWEEN 2 AND 120`                                                                                                                       | adresses publiques uniques et valides                                                               |
| `organization_members`                                | `UNIQUE (organization_id, user_id) WHERE status = 'active'`                                                                                                                                                                                 | **une adhésion active par utilisateur et organisation**                                             |
| `organization_members`                                | `UNIQUE (organization_id, id)`                                                                                                                                                                                                              | cible des FK composites tenant-safe                                                                 |
| `member_role_assignments`                             | `FK (organization_id, member_id) → organization_members (organization_id, id)`                                                                                                                                                              | **aucune attribution de rôle croisée entre organisations**                                          |
| `member_role_assignments`                             | uniques partiels `(member_id, role_id) WHERE event_id IS NULL` et `(member_id, role_id, event_id) WHERE event_id IS NOT NULL`                                                                                                               | pas de doublon de rôle par périmètre                                                                |
| `roles`                                               | `UNIQUE (key) WHERE organization_id IS NULL`, `UNIQUE (organization_id, key)`                                                                                                                                                               | rôles système uniques, rôles custom par organisation                                                |
| `permissions`                                         | `UNIQUE (key)`, `CHECK key ~ '^[a-z]+\.[a-z]+$'`                                                                                                                                                                                            | catalogue normalisé                                                                                 |
| `organization_invitations`                            | `UNIQUE (token_hash)`, `UNIQUE (organization_id, email) WHERE status = 'pending'`, `CHECK email = lower(email)`                                                                                                                             | jeton unique, une invitation en attente par adresse                                                 |
| `events`                                              | `UNIQUE (organization_id, slug)`, `UNIQUE (organization_id, id)`, `CHECK ends_at > starts_at`, `CHECK doors_at <= starts_at`, `CHECK capacity >= 0`, `CHECK version >= 1`, `CHECK status <> 'cancelled' OR cancellation_reason IS NOT NULL` | adresse publique unique par organisation, dates cohérentes, annulation toujours motivée             |
| `events`                                              | `FK (organization_id, location_id) → event_locations (organization_id, id) ON DELETE SET NULL`                                                                                                                                              | **un événement ne peut pas pointer un lieu d'une autre organisation**                               |
| `event_settings`                                      | `FK (organization_id, event_id) → events (organization_id, id)`                                                                                                                                                                             | réglages toujours du même tenant                                                                    |
| `member_role_assignments`, `organization_invitations` | `FK (organization_id, event_id) → events (organization_id, id) ON DELETE CASCADE`                                                                                                                                                           | **un droit limité à un événement ne peut viser qu'un événement du même tenant** ; supprimé avec lui |
| `event_media`                                         | `UNIQUE (event_id) WHERE role = 'poster'`, FK composite vers `events`                                                                                                                                                                       | une affiche par événement                                                                           |
| `stored_files`                                        | `UNIQUE (bucket, object_key)`, `CHECK mime_type ~ '^[a-z]+/[a-z0-9.+-]+$'`                                                                                                                                                                  | un objet de stockage référencé une fois                                                             |
| `form_*`                                              | `UNIQUE (form_id, key)`, `UNIQUE (form_id, subject_type, subject_id)`, `UNIQUE (submission_id, field_id)`, FK composites                                                                                                                    | formulaires dynamiques cohérents par tenant (servis en phases 3/5)                                  |
| `audit_logs`                                          | `CHECK actor_kind IN (…)`, `CHECK action ~ '^[a-z_]+\.[a-z_]+$'`                                                                                                                                                                            | journal structuré                                                                                   |
| `membership_plans`                                    | `UNIQUE (organization_id, slug)`, `CHECK period` (fixe : dates cohérentes ; glissante : 1–60 mois), `CHECK price_minor >= 0`                                                                                                                | une formule par adresse et organisation ; période toujours exploitable                              |
| `memberships`                                         | `UNIQUE (organization_id, member_email) WHERE status = 'active'`, `UNIQUE (organization_id, user_id) WHERE status = 'active' AND user_id IS NOT NULL`                                                                                       | **une seule adhésion active par personne et organisation** (doublon de webhook inclus)              |
| `memberships`                                         | `UNIQUE (organization_id, number)`, `UNIQUE (access_token_hash)`, `CHECK active_has_validity`, `CHECK cancel_reason`, FK composite `renewed_from → memberships (organization_id, id)`                                                       | numéros stables, jeton unique, pas d'adhésion active sans dates, renouvellement intra-organisation  |
| `membership_validity_changes`                         | aucune mise à jour ni suppression (append-only par le domaine), `CHECK kind ~ '^[a-z_]+$'`                                                                                                                                                  | historique de validité inaltérable                                                                  |
| `payments`                                            | `order_id` nullable, `membership_id` nullable, `CHECK payments_target_exclusive` (exactement une cible)                                                                                                                                     | un paiement règle une commande **ou** une cotisation, jamais les deux ni aucune                     |
| infra                                                 | `UNIQUE (scope, key)`, index partiel `status = 'pending'`, uniques partiels des drapeaux                                                                                                                                                    | idempotence, relais, surcharge par organisation                                                     |

Les machines à états commande (`draft → reserved → awaiting_payment → paid`, `expired`, `failed → awaiting_payment`, `paid → partially_refunded → refunded`, `expired → paid` pour un paiement tardif réconcilié), paiement (`created → pending → succeeded | failed | cancelled`, `failed → succeeded` : un succès tardif prévaut) et billet (`pending → valid → used`, `valid | used → refunded`, `revoked`) vivent dans `packages/domain/src/ticketing/state-machines.ts`. L'absence de survente est garantie en transaction : verrou de ligne sur l'organisation puis sur l'événement à chaque réservation, disponibilité recalculée (quota, pool, capacité − billets émis − réservations actives).

La machine à états des événements (`draft → published → completed | cancelled`, `suspended`, `archived` terminal) vit dans `packages/domain/src/events/state-machine.ts` ; la base ne garde que les invariants exprimables (`CHECK`), la transition est gardée en transaction (verrou `FOR UPDATE` sur l'organisation à la publication, `version` pour la concurrence optimiste).

Le dernier propriétaire est protégé par règle métier (transaction avec `SELECT … FOR UPDATE` sur l'organisation), pas par contrainte SQL : PostgreSQL ne peut pas exprimer « au moins une ligne » sans trigger ; un trigger pourra être ajouté en phase 10 si l'audit le recommande.
