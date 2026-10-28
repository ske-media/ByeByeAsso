import { timingSafeEqual } from "node:crypto";
import { platformSnapshot, renderPrometheus } from "@kroov/domain/platform";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/metrics — Prometheus exposition, protected by `Authorization: Bearer <METRICS_TOKEN>`.
 * Disabled (404) when no token is configured. Counts and ages only: no personal data.
 */
export async function GET(request: Request): Promise<Response> {
  const token = env().METRICS_TOKEN;
  if (!token) return new Response("Not found", { status: 404 });
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } });
  }
  const body = renderPrometheus(await platformSnapshot(db()));
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" },
  });
}
