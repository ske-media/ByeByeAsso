import type { ServerEnv } from "@kroov/config/env";
import type { Database } from "@kroov/database";
import { expireMemberships, sendRenewalReminders } from "@kroov/domain/memberships";
import type { Logger } from "pino";
import { DEFAULT_QUEUE_OPTIONS, QUEUES, type Queue } from "../queue";
import { buildTicketingContext } from "./ticketing";

/**
 * - `memberships.expire` (daily, 03:10 UTC): active/suspended memberships past `valid_until`
 *   → expired, validity change recorded, member notified.
 * - `memberships.remind` (daily, 08:40 UTC): one J-30 renewal reminder per membership
 *   (`reminder_sent_at` guarantees it is sent once).
 */
export async function registerMembershipJobs(ctx: {
  queue: Queue;
  db: Database;
  env: ServerEnv;
  logger: Logger;
}): Promise<void> {
  const ticketing = buildTicketingContext(ctx.env);
  await ctx.queue.createQueue(QUEUES.membershipsExpire, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.membershipsExpire, async () => {
    const count = await expireMemberships(ctx.db, ticketing, { kind: "system", job: QUEUES.membershipsExpire });
    if (count > 0) ctx.logger.info({ count }, "memberships expired");
  });
  await ctx.queue.schedule(QUEUES.membershipsExpire, "10 3 * * *", undefined, { tz: "UTC" });

  await ctx.queue.createQueue(QUEUES.membershipsRemind, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.membershipsRemind, async () => {
    const count = await sendRenewalReminders(ctx.db, ticketing, { kind: "system", job: QUEUES.membershipsRemind });
    if (count > 0) ctx.logger.info({ count }, "renewal reminders sent");
  });
  await ctx.queue.schedule(QUEUES.membershipsRemind, "40 8 * * *", undefined, { tz: "UTC" });
}
