import type { Database } from "@kroov/database";
import { sql } from "drizzle-orm";
import { purgeRateLimits } from "./rate-limit";

/**
 * Data retention (phase 10). Technical records only — business records (orders, ledger, audit,
 * consents) are kept. Each purge is bounded by a cutoff computed from `now`.
 */
export interface RetentionPolicy {
  /** Dispatched outbox rows are only useful for debugging; failed ones are kept for inspection. */
  outboxDispatchedDays: number;
  jobExecutionsDays: number;
  rateLimitDays: number;
  /** Read notifications older than this are dropped (unread ones stay). */
  readNotificationsDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  outboxDispatchedDays: 30,
  jobExecutionsDays: 90,
  rateLimitDays: 1,
  readNotificationsDays: 180,
};

export interface RetentionReport {
  outboxEvents: number;
  jobExecutions: number;
  rateLimits: number;
  notifications: number;
}

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export async function applyRetention(
  db: Database,
  policy: RetentionPolicy = DEFAULT_RETENTION,
  now = new Date(),
): Promise<RetentionReport> {
  const outbox = await db.execute<{ id: string }>(sql`
    delete from outbox_events where status = 'dispatched' and dispatched_at < ${daysAgo(now, policy.outboxDispatchedDays)} returning id
  `);
  const jobs = await db.execute<{ id: string }>(sql`
    delete from job_executions where started_at < ${daysAgo(now, policy.jobExecutionsDays)} and status in ('succeeded', 'failed') returning id
  `);
  const rateLimits = await purgeRateLimits(db, daysAgo(now, policy.rateLimitDays));
  const notifications = await db.execute<{ id: string }>(sql`
    delete from notifications where read_at is not null and read_at < ${daysAgo(now, policy.readNotificationsDays)} returning id
  `);
  return {
    outboxEvents: outbox.rows.length,
    jobExecutions: jobs.rows.length,
    rateLimits,
    notifications: notifications.rows.length,
  };
}
