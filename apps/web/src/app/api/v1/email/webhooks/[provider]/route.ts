import { recordDeliveryEvent, verifyEmailWebhook, WebhookVerificationError } from "@kroov/domain/marketing";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { email } from "@/lib/email";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * POST /api/v1/email/webhooks/{provider} — e-mail provider → Kroov (delivered / bounced / complained / failed).
 * Server-to-server: no session, no origin check; the signature over the RAW body authenticates the call.
 * Only the configured provider is accepted. Idempotent by (provider, message id). 200 once recorded.
 */
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await context.params;
  if (provider !== email().name) return apiError(404, "not_found", "Fournisseur inconnu.");
  const raw = await request.text();
  const headers = {
    "x-kroov-signature": request.headers.get("x-kroov-signature"),
    "svix-id": request.headers.get("svix-id"),
    "svix-timestamp": request.headers.get("svix-timestamp"),
    "svix-signature": request.headers.get("svix-signature"),
  };
  let events: ReturnType<typeof verifyEmailWebhook>;
  try {
    events = verifyEmailWebhook(provider, raw, headers, env().EMAIL_WEBHOOK_SECRET);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      logger.warn({ provider, err: error.message }, "email webhook signature rejected");
      return apiError(400, "invalid_signature", "Signature invalide.");
    }
    return apiError(400, "invalid_json", "Corps illisible.");
  }
  try {
    const outcomes = [];
    for (const e of events) outcomes.push(await recordDeliveryEvent(db(), provider, e));
    return Response.json({ received: true, outcomes });
  } catch (error) {
    logger.error({ provider, err: error }, "email webhook processing failed");
    return apiError(500, "internal", "Traitement différé.");
  }
}
