# Diagramme entité-relation

Mis à jour à chaque phase. Phase 0 : INFRASTRUCTURE · Phase 1 : AUTH (Better Auth) + IDENTITY · Phase 2 : EVENTS (lieux, événements, réglages, fichiers/médias, formulaires dynamiques — ces trois derniers groupes sont posés en base et seront servis par les phases 3, 5 et 9).

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
| infra                                                 | `UNIQUE (scope, key)`, index partiel `status = 'pending'`, uniques partiels des drapeaux                                                                                                                                                    | idempotence, relais, surcharge par organisation                                                     |

La machine à états des événements (`draft → published → completed | cancelled`, `suspended`, `archived` terminal) vit dans `packages/domain/src/events/state-machine.ts` ; la base ne garde que les invariants exprimables (`CHECK`), la transition est gardée en transaction (verrou `FOR UPDATE` sur l'organisation à la publication, `version` pour la concurrence optimiste).

Le dernier propriétaire est protégé par règle métier (transaction avec `SELECT … FOR UPDATE` sur l'organisation), pas par contrainte SQL : PostgreSQL ne peut pas exprimer « au moins une ligne » sans trigger ; un trigger pourra être ajouté en phase 10 si l'audit le recommande.
