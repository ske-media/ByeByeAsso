import { type Database, schema } from "@kroov/database";
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

  // Heartbeat proves the scheduler is alive; visible in pgboss.job and in logs.
  await ctx.queue.createQueue(QUEUES.maintenanceHeartbeat, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.maintenanceHeartbeat, async () => {
    ctx.logger.debug("heartbeat");
  });
  await ctx.queue.schedule(QUEUES.maintenanceHeartbeat, "* * * * *", undefined, { tz: "UTC" });
}
