import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps } from "./_shared";
import { organizations } from "./identity";

/**
 * INFRASTRUCTURE domain.
 *
 * `organization_id` columns are nullable (platform-level rows) and reference `organizations`.
 *
 * Authorization scope: platform-internal. Never exposed through /api/v1 directly.
 * Retention: see each table.
 */

/* ------------------------------------------------------------------------- */
/* idempotency_records                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Stores the outcome of an idempotent command keyed by (scope, key).
 * - scope: logical namespace, e.g. "checkout", "refund", "webhook:stripe".
 * - key: client-supplied Idempotency-Key or provider event id.
 * - requestHash: SHA-256 of the canonical request body; a replay with a different body is a conflict.
 * - response: stored result returned verbatim on replay.
 * Retention: rows expire at `expiresAt` (default 24 h for client keys, 30 days for webhook events).
 */
export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: id(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["in_progress", "completed", "failed"] })
      .notNull()
      .default("in_progress"),
    responseStatus: integer("response_status"),
    response: jsonb("response"),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idempotency_records_scope_key_uq").on(t.scope, t.key),
    index("idempotency_records_expires_at_idx").on(t.expiresAt),
    check("idempotency_records_key_len", sql`char_length(${t.key}) between 1 and 255`),
  ],
);

/* ------------------------------------------------------------------------- */
/* outbox_events                                                              */
/* ------------------------------------------------------------------------- */

export const outboxStatus = pgEnum("outbox_status", ["pending", "dispatched", "failed"]);

/**
 * Transactional outbox: domain events are written in the SAME transaction as the
 * state change, then relayed to the job queue by the worker. Guarantees no event is
 * lost if the process dies between commit and enqueue.
 * Retention: dispatched rows older than 30 days are pruned by a maintenance job.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    /** Aggregate that emitted the event, e.g. "order", "schedule_version". */
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    /** Dotted event name, e.g. "order.paid". */
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    /** Tenant scope when applicable. */
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Times a `failed` row was put back to `pending` by the bounded requeue job (phase 9). */
    requeueCount: integer("requeue_count").notNull().default(0),
    lastError: text("last_error"),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("outbox_events_pending_idx").on(t.availableAt).where(sql`${t.status} = 'pending'`),
    index("outbox_events_aggregate_idx").on(t.aggregateType, t.aggregateId),
    check("outbox_events_attempts_nonneg", sql`${t.attempts} >= 0`),
    check("outbox_events_requeue_nonneg", sql`${t.requeueCount} >= 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* job_executions                                                             */
/* ------------------------------------------------------------------------- */

export const jobExecutionStatus = pgEnum("job_execution_status", ["running", "succeeded", "failed", "retrying"]);

/**
 * Audit trail of background job runs (the queue itself is pg-boss; this is the durable,
 * queryable history the organizer UI and support can read).
 * Retention: 90 days.
 */
export const jobExecutions = pgTable(
  "job_executions",
  {
    id: id(),
    queue: text("queue").notNull(),
    /** pg-boss job id. */
    jobId: text("job_id").notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: jobExecutionStatus("status").notNull().default("running"),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    uniqueIndex("job_executions_job_attempt_uq").on(t.jobId, t.attempt),
    index("job_executions_queue_started_idx").on(t.queue, t.startedAt),
    check("job_executions_attempt_pos", sql`${t.attempt} >= 1`),
  ],
);

/* ------------------------------------------------------------------------- */
/* feature_flags                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Simple feature flags: global default plus optional per-organization override.
 * Evaluated server-side only.
 */
export const featureFlags = pgTable(
  "feature_flags",
  {
    id: id(),
    key: text("key").notNull(),
    description: text("description").notNull().default(""),
    enabled: boolean("enabled").notNull().default(false),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("feature_flags_key_global_uq").on(t.key).where(sql`${t.organizationId} is null`),
    uniqueIndex("feature_flags_key_org_uq").on(t.key, t.organizationId).where(sql`${t.organizationId} is not null`),
    check("feature_flags_key_format", sql`${t.key} ~ '^[a-z0-9_.-]{2,80}$'`),
  ],
);

/* ------------------------------------------------------------------------- */
/* request_rate_limits (phase 10)                                             */
/* ------------------------------------------------------------------------- */

/**
 * Fixed-window counters for anonymous / public surfaces, shared by every web instance.
 * One row per (scope, subject, window); incremented with an upsert. Rows older than a day
 * are purged by the retention job.
 */
export const requestRateLimits = pgTable(
  "request_rate_limits",
  {
    id: id(),
    scope: text("scope").notNull(),
    subject: text("subject").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("request_rate_limits_uq").on(t.scope, t.subject, t.windowStart),
    index("request_rate_limits_window_idx").on(t.windowStart),
    check("request_rate_limits_count_nonneg", sql`${t.count} >= 0`),
  ],
);
