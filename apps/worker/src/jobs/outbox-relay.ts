import { type Database, schema } from "@kroov/database";
import { and, eq, lt, lte, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { DEFAULT_QUEUE_OPTIONS, QUEUES, type Queue } from "../queue";

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 10;

/**
 * Outbox relay: every few seconds, claim pending outbox rows (FOR UPDATE SKIP LOCKED so
 * several workers never relay the same row), publish them to their queue and mark them
 * dispatched. Failures increment `attempts` with exponential backoff; after MAX_ATTEMPTS
 * the row is marked failed for human inspection.
 *
 * Rows are published to the single `domain.events` queue (declared by the worker, see
 * jobs/domain-events.ts) with `eventType` in the payload; the consumer routes by type.
 * (Phases 0–8 published to `event.<type>` queues that were never declared, so pg-boss refused
 * every send and the rows ended `failed` — fixed in phase 9, with a bounded requeue job.)
 */
export async function relayOutboxBatch(db: Database, queue: Queue, logger: Logger): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{
      id: string;
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: unknown;
      organization_id: string | null;
      attempts: number;
    }>(sql`
      select id, event_type, aggregate_type, aggregate_id, payload, organization_id, attempts
      from outbox_events
      where status = 'pending' and available_at <= now()
      order by created_at
      limit ${BATCH_SIZE}
      for update skip locked
    `);

    let relayed = 0;
    for (const row of rows.rows) {
      try {
        await queue.send(QUEUES.domainEvents, {
          outboxId: row.id,
          eventType: row.event_type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          organizationId: row.organization_id,
          payload: row.payload,
        });
        await tx
          .update(schema.outboxEvents)
          .set({ status: "dispatched", dispatchedAt: new Date() })
          .where(eq(schema.outboxEvents.id, row.id));
        relayed += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        const delaySeconds = Math.min(2 ** attempts, 600);
        await tx
          .update(schema.outboxEvents)
          .set({
            attempts,
            status: failed ? "failed" : "pending",
            lastError: error instanceof Error ? error.message : String(error),
            availableAt: new Date(Date.now() + delaySeconds * 1000),
          })
          .where(and(eq(schema.outboxEvents.id, row.id), lte(schema.outboxEvents.attempts, row.attempts)));
        logger.warn({ outboxId: row.id, attempts, failed }, "outbox relay failed for row");
      }
    }
    return relayed;
  });
}

/** Bounded requeue of failed rows: back to pending with a fresh attempt budget, at most MAX_REQUEUES times. */
export const MAX_REQUEUES = 3;

export async function requeueFailedOutbox(db: Database): Promise<number> {
  const rows = await db
    .update(schema.outboxEvents)
    .set({
      status: "pending",
      attempts: 0,
      requeueCount: sql`${schema.outboxEvents.requeueCount} + 1`,
      availableAt: new Date(),
    })
    .where(and(eq(schema.outboxEvents.status, "failed"), lt(schema.outboxEvents.requeueCount, MAX_REQUEUES)))
    .returning({ id: schema.outboxEvents.id });
  return rows.length;
}

export async function registerOutboxRelay(ctx: { queue: Queue; db: Database; logger: Logger }): Promise<void> {
  await ctx.queue.createQueue(QUEUES.outboxRelay, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.createQueue(QUEUES.outboxRequeueFailed, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.outboxRequeueFailed, { batchSize: 1 }, async () => {
    const requeued = await requeueFailedOutbox(ctx.db);
    if (requeued > 0) ctx.logger.warn({ requeued }, "failed outbox rows requeued");
  });
  await ctx.queue.schedule(QUEUES.outboxRequeueFailed, "0 * * * *", undefined, { tz: "UTC" });
  await ctx.queue.work(QUEUES.outboxRelay, { batchSize: 1 }, async () => {
    const relayed = await relayOutboxBatch(ctx.db, ctx.queue, ctx.logger);
    if (relayed > 0) ctx.logger.info({ relayed }, "outbox relayed");
  });
  // Safety-net sweep every minute (pg-boss cron granularity). Producers enqueue
  // `outbox.relay` directly after commit for low latency (Phase 1+), this cron only
  // catches rows left behind by a crash between commit and enqueue.
  await ctx.queue.schedule(QUEUES.outboxRelay, "* * * * *", undefined, { tz: "UTC" });
}
