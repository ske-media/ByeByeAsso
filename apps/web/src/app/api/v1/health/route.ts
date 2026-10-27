import { pingDatabase } from "@kroov/database";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health
 * Authentication: none. Permission: none.
 * Response 200 { status: "ok", checks: { database: { ok, latencyMs } } }
 * Response 503 when a dependency is down (never 200 with a fake "ok").
 * Idempotent, read-only, no transaction.
 */
export async function GET() {
  const database = await pingDatabase(db());
  const healthy = database.ok;
  if (!healthy) {
    logger.error({ database }, "health check failed");
  }
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      version: process.env.npm_package_version ?? "0.1.0",
      checks: { database },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
