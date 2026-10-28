import { platformSnapshot } from "@kroov/domain/platform";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health
 * Authentication: none. Permission: none.
 * 200 { status: "ok" | "degraded", checks } — `degraded` (still 200) when the worker heartbeat is
 * stale or the outbox backlog grows; 503 only when the database is down. Never a fake "ok".
 * Idempotent, read-only, no personal data.
 */
export async function GET() {
  const s = await platformSnapshot(db());
  const databaseDown = !s.database.ok;
  const degraded = !s.worker.alive || s.outbox.failed > 0 || (s.outbox.oldestPendingSeconds ?? 0) > 300;
  if (databaseDown) logger.error({ database: s.database }, "health check failed");
  else if (degraded) logger.warn({ worker: s.worker, outbox: s.outbox }, "health degraded");
  return NextResponse.json(
    {
      status: databaseDown ? "down" : degraded ? "degraded" : "ok",
      version: process.env.npm_package_version ?? "0.1.0",
      checks: {
        database: s.database,
        worker: { alive: s.worker.alive, lastHeartbeatAt: s.worker.lastHeartbeatAt, ageSeconds: s.worker.ageSeconds },
        outbox: s.outbox,
      },
      timestamp: new Date().toISOString(),
    },
    { status: databaseDown ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
