import { z } from "zod";
import { apiError, apiRoute, ok, parseBody } from "@/lib/api";
import { env } from "@/lib/env";
import { fakeProvider } from "@/lib/ticketing";

type Params = { sessionId: string };

/** GET — simulated provider page data (development/test only; 404 otherwise). */
export const GET = apiRoute<Params>({ auth: "optional" }, async (_ctx, { sessionId }) => {
  const p = fakeProvider();
  const s = p?.sessions.get(sessionId);
  if (!p || !s) return apiError(404, "not_found", "Session de paiement introuvable.");
  return ok({
    id: s.id,
    orderNumber: s.orderNumber,
    amountMinor: s.amountMinor,
    currency: s.currency,
    description: s.description,
    customerEmail: s.customerEmail,
    status: s.status,
    successUrl: s.successUrl,
    cancelUrl: s.cancelUrl,
    expiresAt: s.expiresAt,
  });
});

/**
 * POST — { decision: "succeeded" | "failed" } : settles the simulated session and delivers the
 * signed webhook to our own endpoint, exactly like a provider would (over HTTP, signature checked).
 */
export const POST = apiRoute<Params>({ auth: "optional" }, async (ctx, { sessionId }) => {
  const p = fakeProvider();
  if (!p) return apiError(404, "not_found", "Fournisseur simulé indisponible.");
  const { decision } = await parseBody(ctx.request, z.object({ decision: z.enum(["succeeded", "failed"]) }));
  let settled: ReturnType<typeof p.settle>;
  try {
    settled = p.settle(sessionId, decision);
  } catch {
    return apiError(404, "not_found", "Session de paiement introuvable.");
  }
  const res = await fetch(`${env().APP_URL}/api/v1/payments/webhooks/fake`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kroov-signature": settled.signature },
    body: settled.body,
  });
  const json = (await res.json().catch(() => ({}))) as { outcome?: string };
  return ok({
    status: settled.session.status,
    webhookStatus: res.status,
    outcome: json.outcome ?? null,
    redirectUrl: settled.session.status === "succeeded" ? settled.session.successUrl : settled.session.cancelUrl,
  });
});
