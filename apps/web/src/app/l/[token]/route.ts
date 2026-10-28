import { trackClick } from "@kroov/domain/marketing";
import { enforceRateLimit } from "@/lib/api";
import { db } from "@/lib/db";
import { marketingContext } from "@/lib/marketing";

/**
 * GET /l/{token}?r={recipientRef} — tracked campaign link. Records the click (no IP) and redirects
 * ONLY to the registered target, with source parameters and the attribution parameter `kc`.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const limited = await enforceRateLimit(request, { scope: "public.tracked-link", limit: 120, windowSeconds: 60 });
  if (limited) return limited;
  const { token } = await context.params;
  const url = new URL(request.url);
  const result = await trackClick(
    db(),
    marketingContext(),
    token,
    url.searchParams.get("r"),
    request.headers.get("user-agent"),
  );
  if (!result)
    return new Response("Lien inconnu.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return Response.redirect(result.redirectUrl, 302);
}
