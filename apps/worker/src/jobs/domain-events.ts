import type { Database } from "@kroov/database";
import { type DomainEventMessage, handleDomainEvent } from "@kroov/domain/notifications";
import type { Logger } from "pino";
import { DEFAULT_QUEUE_OPTIONS, QUEUES, type Queue } from "../queue";

/**
 * `domain.events` consumer (phase 9): every relayed outbox row lands here. Routing lives in
 * the domain (`handleDomainEvent`): notifications for the members holding the relevant
 * permission, system tasks. Unknown event types are acknowledged (nothing to do); a thrown
 * error lets pg-boss retry with backoff — handlers are idempotent so retries never duplicate.
 */
export async function registerDomainEventConsumer(ctx: { queue: Queue; db: Database; logger: Logger }): Promise<void> {
  await ctx.queue.createQueue(QUEUES.domainEvents, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work<DomainEventMessage>(QUEUES.domainEvents, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) {
      const msg = job.data;
      const result = await handleDomainEvent(ctx.db, msg);
      if (result.handled && (result.notified > 0 || result.tasksCreated > 0)) {
        ctx.logger.info(
          { eventType: msg.eventType, outboxId: msg.outboxId, notified: result.notified, tasks: result.tasksCreated },
          "domain event handled",
        );
      }
    }
  });
}
