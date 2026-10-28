import type { ServerEnv } from "@kroov/config/env";
import type { Database } from "@kroov/database";
import { dispatchDueCampaigns, type MarketingContext } from "@kroov/domain/marketing";
import type { Logger } from "pino";
import { DEFAULT_QUEUE_OPTIONS, QUEUES, type Queue } from "../queue";
import { buildTicketingContext } from "./ticketing";

export function buildMarketingContext(env: ServerEnv): MarketingContext {
  const t = buildTicketingContext(env);
  return {
    email: t.email,
    appName: t.appName,
    appUrl: t.appUrl,
    credentialSecret: t.credentialSecret,
    batchSize: env.CAMPAIGN_BATCH_SIZE,
  };
}

/**
 * `campaigns.dispatch` (every minute): campaigns scheduled and due — or left `sending` by a crash —
 * are claimed under `FOR UPDATE SKIP LOCKED`, their audience re-validated (consent, suppression,
 * duplicates, validity) and their recipients sent in batches. `sent` recipients are never re-sent.
 */
export async function registerMarketingJobs(ctx: {
  queue: Queue;
  db: Database;
  env: ServerEnv;
  logger: Logger;
}): Promise<void> {
  const marketing = buildMarketingContext(ctx.env);
  await ctx.queue.createQueue(QUEUES.campaignsDispatch, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.campaignsDispatch, { batchSize: 1 }, async () => {
    const processed = await dispatchDueCampaigns(ctx.db, marketing, { kind: "system", job: QUEUES.campaignsDispatch });
    if (processed > 0) ctx.logger.info({ processed }, "campaigns dispatched");
  });
  await ctx.queue.schedule(QUEUES.campaignsDispatch, "* * * * *", undefined, { tz: "UTC" });
}
