import { PgBoss } from "pg-boss";
import type { Logger } from "pino";

/**
 * pg-boss keeps the job queue in PostgreSQL (schema `pgboss`), which gives us:
 * - durability without a second datastore,
 * - at-least-once delivery with retries and backoff,
 * - transactional enqueue alongside domain writes (outbox pattern).
 */
export type Queue = PgBoss;

export async function createQueue(options: { connectionString: string; logger: Logger }): Promise<Queue> {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: "pgboss",
    application_name: "kroov-worker",
  });

  boss.on("error", (error: Error) => options.logger.error({ error }, "pg-boss error"));
  boss.on("stopped", () => options.logger.info("pg-boss stopped"));

  await boss.start();
  return boss;
}

/**
 * Queue names are centralised so producers (web) and consumers (worker) agree.
 * Queue-level retention/retry policies are declared once in `QUEUE_OPTIONS`.
 */
export const QUEUES = {
  outboxRelay: "outbox.relay",
  maintenanceExpireIdempotency: "maintenance.expire-idempotency",
  maintenanceHeartbeat: "maintenance.heartbeat",
  eventsComplete: "events.complete-ended",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Retry with exponential backoff; keep completed rows 7 days for support inspection. */
export const DEFAULT_QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 2,
  retryBackoff: true,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
} as const;
