import { describe, expect, it } from "vitest";
import { type PlatformSnapshot, renderPrometheus } from "./observability";
import { decide, windowStartFor } from "./rate-limit";

describe("platform · rate limit windows", () => {
  it("aligns every instance on the same fixed window", () => {
    const a = windowStartFor(new Date("2026-10-28T20:00:17Z"), 60);
    const b = windowStartFor(new Date("2026-10-28T20:00:59Z"), 60);
    expect(a.toISOString()).toBe("2026-10-28T20:00:00.000Z");
    expect(b.getTime()).toBe(a.getTime());
    expect(windowStartFor(new Date("2026-10-28T20:01:00Z"), 60).getTime()).toBe(a.getTime() + 60_000);
  });

  it("refuses the (limit + 1)-th request with a Retry-After of at least one second", () => {
    const rule = { scope: "t", limit: 3, windowSeconds: 60 };
    const start = windowStartFor(new Date("2026-10-28T20:00:17Z"), 60);
    expect(decide(3, rule, start, new Date("2026-10-28T20:00:17Z"))).toMatchObject({ allowed: true, remaining: 0 });
    const refused = decide(4, rule, start, new Date("2026-10-28T20:00:59.500Z"));
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(1);
    expect(decide(4, rule, start, new Date("2026-10-28T20:00:17Z")).retryAfterSeconds).toBe(43);
  });
});

describe("platform · Prometheus exposition", () => {
  it("renders gauges with labels, no personal data", () => {
    const s: PlatformSnapshot = {
      database: { ok: true, latencyMs: 3 },
      worker: { lastHeartbeatAt: new Date(), ageSeconds: 12, alive: true },
      outbox: { pending: 2, failed: 1, oldestPendingSeconds: 40 },
      queues: [{ name: "domain.events", state: "created", count: 5 }],
      business: { ordersPaid24h: 7, webhooksFailed24h: 0 },
    };
    const out = renderPrometheus(s);
    expect(out).toContain("# TYPE kroov_database_up gauge\nkroov_database_up 1");
    expect(out).toContain('kroov_outbox_events{status="pending"} 2');
    expect(out).toContain('kroov_outbox_events{status="failed"} 1');
    expect(out).toContain('kroov_queue_jobs{queue="domain.events",state="created"} 5');
    expect(out).toContain("kroov_orders_paid_24h 7");
    expect(out.endsWith("\n")).toBe(true);
    expect(out).not.toMatch(/@/);
  });
});
