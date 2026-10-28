import { confirmUnsubscribe } from "@kroov/domain/marketing";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { marketingContext } from "@/lib/marketing";

/**
 * List-Unsubscribe target (RFC 8058 one-click). POST from a mail client confirms immediately;
 * GET redirects to the human page. No session, no origin check: the signed reference IS the authorization.
 */
export async function POST(request: Request, context: { params: Promise<{ ref: string }> }): Promise<Response> {
  const { ref } = await context.params;
  const done = await confirmUnsubscribe(db(), marketingContext(), ref, request.headers.get("user-agent"));
  if (!done) return new Response("Référence inconnue.", { status: 404 });
  return Response.json({ unsubscribed: true });
}

export async function GET(_request: Request, context: { params: Promise<{ ref: string }> }): Promise<Response> {
  const { ref } = await context.params;
  return Response.redirect(`${env().APP_URL}/desinscription/${encodeURIComponent(ref)}`, 302);
}
