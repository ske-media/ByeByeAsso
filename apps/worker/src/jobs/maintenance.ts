import { type Database, schema } from "@kroov/database";
import { applyRetention } from "@kroov/domain/platform";
import { lt } from "drizzle-orm";
import type { Logger } from "pino";
import { DEFAULT_QUEUE_OPTIONS, QUEUES, type Queue } from "../queue";

/** Delete expired idempotency records. Runs hourly. */
export async function expireIdempotencyRecords(db: Database): Promise<number> {
  const deleted = await db
    .delete(schema.idempotencyRecords)
    .where(lt(schema.idempotencyRecords.expiresAt, new Date()))
    .returning({ id: schema.idempotencyRecords.id });
  return deleted.length;
}

export async function registerMaintenanceJobs(ctx: { queue: Queue; db: Database; logger: Logger }): Promise<void> {
  await ctx.queue.createQueue(QUEUES.maintenanceExpireIdempotency, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.maintenanceExpireIdempotency, async () => {
    const count = await expireIdempotencyRecords(ctx.db);
    if (count > 0) ctx.logger.info({ count }, "expired idempotency records removed");
  });
  await ctx.queue.schedule(QUEUES.maintenanceExpireIdempotency, "7 * * * *", undefined, { tz: "UTC" });

  // Heartbeat proves the scheduler is alive: one `job_executions` row per minute, read by
  // /api/v1/health and /api/v1/metrics (phase 10).
  await ctx.queue.createQueue(QUEUES.maintenanceHeartbeat, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.maintenanceHeartbeat, async (jobs) => {
    const started = new Date();
    for (const job of jobs) {
      await ctx.db
        .insert(schema.jobExecutions)
        .values({
          queue: QUEUES.maintenanceHeartbeat,
          jobId: job.id,
          status: "succeeded",
          startedAt: started,
          finishedAt: new Date(),
          durationMs: Date.now() - started.getTime(),
        })
        .onConflictDoNothing();
    }
    ctx.logger.debug("heartbeat");
  });
  await ctx.queue.schedule(QUEUES.maintenanceHeartbeat, "* * * * *", undefined, { tz: "UTC" });

  // Retention (phase 10): daily purge of technical records (never business records).
  await ctx.queue.createQueue(QUEUES.maintenanceRetention, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.maintenanceRetention, async () => {
    const report = await applyRetention(ctx.db);
    ctx.logger.info(report, "retention applied");
  });
  await ctx.queue.schedule(QUEUES.maintenanceRetention, "25 4 * * *", undefined, { tz: "UTC" });
}
