# Diagramme entité-relation

Mis à jour à chaque phase. Phase 0 : domaine INFRASTRUCTURE uniquement (sans FK tenant ; la table `organizations` arrive en phase 1 et les colonnes `organization_id` ci-dessous recevront alors leur clé étrangère).

```mermaid
erDiagram
  idempotency_records {
    uuid id PK
    text scope
    text key
    text request_hash
    text status "in_progress | completed | failed"
    int response_status
    jsonb response
    timestamptz locked_at
    timestamptz completed_at
    timestamptz expires_at
    timestamptz created_at
    timestamptz updated_at
  }
  outbox_events {
    uuid id PK
    text aggregate_type
    text aggregate_id
    text event_type
    jsonb payload
    text organization_id "FK en phase 1"
    outbox_status status
    int attempts
    text last_error
    timestamptz available_at
    timestamptz dispatched_at
    timestamptz created_at
  }
  job_executions {
    uuid id PK
    text queue
    text job_id
    int attempt
    job_execution_status status
    text organization_id "FK en phase 1"
    jsonb input
    jsonb output
    text error
    timestamptz started_at
    timestamptz finished_at
    int duration_ms
  }
  feature_flags {
    uuid id PK
    text key
    text description
    boolean enabled
    text organization_id "FK en phase 1 (null = global)"
    timestamptz created_at
    timestamptz updated_at
  }
```

Contraintes :

| Table               | Contrainte                                                        | Rôle                                         |
| ------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| idempotency_records | `UNIQUE (scope, key)`                                             | un seul enregistrement par clé d'idempotence |
| idempotency_records | `CHECK char_length(key) BETWEEN 1 AND 255`                        | clés bornées                                 |
| outbox_events       | index partiel `(available_at) WHERE status = 'pending'`           | relais efficace                              |
| outbox_events       | `CHECK attempts >= 0`                                             |                                              |
| job_executions      | `UNIQUE (job_id, attempt)`                                        | une ligne par tentative                      |
| feature_flags       | `UNIQUE (key) WHERE organization_id IS NULL`                      | un drapeau global par clé                    |
| feature_flags       | `UNIQUE (key, organization_id) WHERE organization_id IS NOT NULL` | une surcharge par organisation               |
| feature_flags       | `CHECK key ~ '^[a-z0-9_.-]{2,80}$'`                               | clés normalisées                             |
