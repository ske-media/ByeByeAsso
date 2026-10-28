import { processProviderEvent } from "@kroov/domain/ticketing";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { paymentProvider, ticketingContext } from "@/lib/ticketing";

/**
 * POST /api/v1/payments/webhooks/{provider} — provider → Kroov. No session, no origin check
 * (server-to-server): the signature over the RAW body is the authentication. Idempotent by
 * (provider, event id). Always 200 once the event is recorded, so the provider stops retrying;
 * 400 on bad signature, 404 on a provider that is not the configured one.
 */
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await context.params;
  const configured = paymentProvider();
  if (provider !== configured.name) return apiError(404, "not_found", "Fournisseur inconnu.");
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature") ?? request.headers.get("x-kroov-signature") ?? "";
  let event: Awaited<ReturnType<typeof configured.verifyWebhook>>;
  try {
    event = await configured.verifyWebhook(raw, signature);
  } catch (error) {
    logger.warn(
      { provider, err: error instanceof Error ? error.message : String(error) },
      "webhook signature rejected",
    );
    return apiError(400, "invalid_signature", "Signature invalide.");
  }
  try {
    const outcome = await processProviderEvent(db(), ticketingContext(), event);
    logger.info({ provider, eventId: event.providerEventId, type: event.type, outcome }, "webhook processed");
    return Response.json({ received: true, outcome });
  } catch (error) {
    logger.error({ provider, eventId: event.providerEventId, err: error }, "webhook processing failed");
    // 500 → the provider retries; the idempotency row carries outcome=error for support.
    return apiError(500, "internal", "Traitement différé.");
  }
}
