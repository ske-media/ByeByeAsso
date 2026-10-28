import type { Database } from "@kroov/database";
import { completeEndedEvents } from "@kroov/domain/events";
import type { Logger } from "pino";
import { DEFAULT_QUEUE_OPTIONS, QUEUES, type Queue } from "../queue";

/**
 * Published events that ended more than 24 h ago become `completed` (state machine transition,
 * audited, outbox `event.completed`). Runs hourly; idempotent — an already completed event is
 * simply not selected again.
 */
export async function registerEventJobs(ctx: { queue: Queue; db: Database; logger: Logger }): Promise<void> {
  await ctx.queue.createQueue(QUEUES.eventsComplete, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.eventsComplete, async () => {
    const count = await completeEndedEvents(ctx.db, { kind: "system", job: QUEUES.eventsComplete });
    if (count > 0) ctx.logger.info({ count }, "ended events marked completed");
  });
  await ctx.queue.schedule(QUEUES.eventsComplete, "23 * * * *", undefined, { tz: "UTC" });
}
