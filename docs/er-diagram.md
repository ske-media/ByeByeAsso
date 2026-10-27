# Diagramme entité-relation

Mis à jour à chaque phase. Phase 1 : AUTH (Better Auth) + IDENTITY ; INFRASTRUCTURE depuis la phase 0.

```mermaid
erDiagram
  users ||--|| user_profiles : "1:1"
  users ||--o{ sessions : has
  users ||--o{ accounts : has
  users ||--o{ organizations : created
  users ||--o{ organization_members : "is member"
  organizations ||--|| organization_settings : "1:1"
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

| Table                      | Contrainte                                                                                                                    | Invariant garanti                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `users`                    | `UNIQUE (email)`                                                                                                              | une identité par adresse                                   |
| `organizations`            | `UNIQUE (slug)`, `CHECK slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'`, `CHECK char_length(name) BETWEEN 2 AND 120`         | adresses publiques uniques et valides                      |
| `organization_members`     | `UNIQUE (organization_id, user_id) WHERE status = 'active'`                                                                   | **une adhésion active par utilisateur et organisation**    |
| `organization_members`     | `UNIQUE (organization_id, id)`                                                                                                | cible des FK composites tenant-safe                        |
| `member_role_assignments`  | `FK (organization_id, member_id) → organization_members (organization_id, id)`                                                | **aucune attribution de rôle croisée entre organisations** |
| `member_role_assignments`  | uniques partiels `(member_id, role_id) WHERE event_id IS NULL` et `(member_id, role_id, event_id) WHERE event_id IS NOT NULL` | pas de doublon de rôle par périmètre                       |
| `roles`                    | `UNIQUE (key) WHERE organization_id IS NULL`, `UNIQUE (organization_id, key)`                                                 | rôles système uniques, rôles custom par organisation       |
| `permissions`              | `UNIQUE (key)`, `CHECK key ~ '^[a-z]+\.[a-z]+$'`                                                                              | catalogue normalisé                                        |
| `organization_invitations` | `UNIQUE (token_hash)`, `UNIQUE (organization_id, email) WHERE status = 'pending'`, `CHECK email = lower(email)`               | jeton unique, une invitation en attente par adresse        |
| `audit_logs`               | `CHECK actor_kind IN (…)`, `CHECK action ~ '^[a-z_]+\.[a-z_]+$'`                                                              | journal structuré                                          |
| infra                      | `UNIQUE (scope, key)`, index partiel `status = 'pending'`, uniques partiels des drapeaux                                      | idempotence, relais, surcharge par organisation            |

Le dernier propriétaire est protégé par règle métier (transaction avec `SELECT … FOR UPDATE` sur l'organisation), pas par contrainte SQL : PostgreSQL ne peut pas exprimer « au moins une ligne » sans trigger ; un trigger pourra être ajouté en phase 10 si l'audit le recommande.
