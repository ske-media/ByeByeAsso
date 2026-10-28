import type { DbExecutor } from "@kroov/database";
import { sql } from "drizzle-orm";

/**
 * Operational snapshot (phase 10): what the health endpoint and the metrics exposition read.
 * No personal data, no secrets — counts, ages and latencies only.
 */
export interface PlatformSnapshot {
  database: { ok: boolean; latencyMs: number };
  worker: { lastHeartbeatAt: Date | null; ageSeconds: number | null; alive: boolean };
  outbox: { pending: number; failed: number; oldestPendingSeconds: number | null };
  queues: Array<{ name: string; state: string; count: number }>;
  business: { ordersPaid24h: number; webhooksFailed24h: number };
}

/** Worker is considered alive when the heartbeat (every minute) is younger than this. */
export const WORKER_HEARTBEAT_MAX_AGE_SECONDS = 180;

export async function platformSnapshot(db: DbExecutor, now = new Date()): Promise<PlatformSnapshot> {
  const t0 = Date.now();
  let dbOk = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbOk = false;
  }
  const latencyMs = Date.now() - t0;
  if (!dbOk) {
    return {
      database: { ok: false, latencyMs },
      worker: { lastHeartbeatAt: null, ageSeconds: null, alive: false },
      outbox: { pending: 0, failed: 0, oldestPendingSeconds: null },
      queues: [],
      business: { ordersPaid24h: 0, webhooksFailed24h: 0 },
    };
  }
  const hb = (
    await db.execute<{ at: Date | null }>(
      sql`select max(started_at) as at from job_executions where queue = 'maintenance.heartbeat' and status = 'succeeded'`,
    )
  ).rows[0];
  const lastHeartbeatAt = hb?.at ? new Date(hb.at) : null;
  const ageSeconds = lastHeartbeatAt ? Math.round((now.getTime() - lastHeartbeatAt.getTime()) / 1000) : null;
  const ob = (
    await db.execute<{ pending: string; failed: string; oldest: Date | null }>(sql`
      select count(*) filter (where status = 'pending')::text as pending,
             count(*) filter (where status = 'failed')::text as failed,
             min(created_at) filter (where status = 'pending') as oldest
      from outbox_events
    `)
  ).rows[0];
  let queues: PlatformSnapshot["queues"] = [];
  try {
    queues = (
      await db.execute<{ name: string; state: string; count: string }>(
        sql`select name, state::text as state, count(*)::text as count from pgboss.job group by name, state order by name, state`,
      )
    ).rows.map((r) => ({ name: r.name, state: r.state, count: Number(r.count) }));
  } catch {
    // pg-boss schema not created yet (worker never started): report nothing rather than fail.
    queues = [];
  }
  const biz = (
    await db.execute<{ paid: string; failed: string }>(sql`
      select (select count(*) from orders where paid_at > now() - interval '24 hours')::text as paid,
             (select count(*) from payment_webhook_events where outcome = 'error' and received_at > now() - interval '24 hours')::text as failed
    `)
  ).rows[0];
  return {
    database: { ok: true, latencyMs },
    worker: {
      lastHeartbeatAt,
      ageSeconds,
      alive: ageSeconds !== null && ageSeconds <= WORKER_HEARTBEAT_MAX_AGE_SECONDS,
    },
    outbox: {
      pending: Number(ob?.pending ?? 0),
      failed: Number(ob?.failed ?? 0),
      oldestPendingSeconds: ob?.oldest ? Math.round((now.getTime() - new Date(ob.oldest).getTime()) / 1000) : null,
    },
    queues,
    business: { ordersPaid24h: Number(biz?.paid ?? 0), webhooksFailed24h: Number(biz?.failed ?? 0) },
  };
}

/** Prometheus text exposition (0.0.4). Pure: unit-tested. */
export function renderPrometheus(s: PlatformSnapshot): string {
  const lines: string[] = [];
  const gauge = (name: string, help: string, value: number, labels: Record<string, string> = {}) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    const l = Object.entries(labels)
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
      .join(",");
    lines.push(`${name}${l ? `{${l}}` : ""} ${value}`);
  };
  gauge("kroov_database_up", "1 when the database answers", s.database.ok ? 1 : 0);
  gauge("kroov_database_latency_ms", "Round-trip of a trivial query", s.database.latencyMs);
  gauge("kroov_worker_alive", "1 when the worker heartbeat is recent", s.worker.alive ? 1 : 0);
  gauge("kroov_worker_heartbeat_age_seconds", "Age of the last worker heartbeat", s.worker.ageSeconds ?? -1);
  gauge("kroov_outbox_events", "Outbox rows by status", s.outbox.pending, { status: "pending" });
  lines.push(`kroov_outbox_events{status="failed"} ${s.outbox.failed}`);
  gauge(
    "kroov_outbox_oldest_pending_seconds",
    "Age of the oldest pending outbox row",
    s.outbox.oldestPendingSeconds ?? 0,
  );
  if (s.queues.length > 0) {
    lines.push("# HELP kroov_queue_jobs pg-boss jobs by queue and state", "# TYPE kroov_queue_jobs gauge");
    for (const q of s.queues) lines.push(`kroov_queue_jobs{queue="${q.name}",state="${q.state}"} ${q.count}`);
  }
  gauge("kroov_orders_paid_24h", "Orders paid in the last 24 hours", s.business.ordersPaid24h);
  gauge(
    "kroov_payment_webhooks_failed_24h",
    "Payment webhooks failed in the last 24 hours",
    s.business.webhooksFailed24h,
  );
  return `${lines.join("\n")}\n`;
}
