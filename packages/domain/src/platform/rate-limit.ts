import type { DbExecutor } from "@kroov/database";
import { sql } from "drizzle-orm";

/**
 * Fixed-window rate limiting backed by PostgreSQL (shared by every web instance).
 * One upsert per request; the window is derived from `now` so clocks of all instances agree
 * on the same bucket. Pure helpers are exported for unit tests.
 */
export interface RateLimitRule {
  /** Logical bucket name, e.g. "public.orders". */
  scope: string;
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets (always ≥ 1 when refused). */
  retryAfterSeconds: number;
  windowStart: Date;
}

export function windowStartFor(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export function decide(count: number, rule: RateLimitRule, windowStart: Date, now: Date): RateLimitDecision {
  const resetAt = windowStart.getTime() + rule.windowSeconds * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000));
  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds,
    windowStart,
  };
}

/** Counts this request and decides. `subject` is the caller (client address, token…). */
export async function consumeRateLimit(
  db: DbExecutor,
  rule: RateLimitRule,
  subject: string,
  now = new Date(),
): Promise<RateLimitDecision> {
  const windowStart = windowStartFor(now, rule.windowSeconds);
  const r = await db.execute<{ count: number }>(sql`
    insert into request_rate_limits (scope, subject, window_start, count)
    values (${rule.scope}, ${subject}, ${windowStart}, 1)
    on conflict (scope, subject, window_start)
    do update set count = request_rate_limits.count + 1, updated_at = now()
    returning count
  `);
  return decide(Number(r.rows[0]?.count ?? 1), rule, windowStart, now);
}

/** Purges buckets older than `olderThan` (retention job). */
export async function purgeRateLimits(db: DbExecutor, olderThan: Date): Promise<number> {
  const r = await db.execute<{ id: string }>(
    sql`delete from request_rate_limits where window_start < ${olderThan} returning id`,
  );
  return r.rows.length;
}
