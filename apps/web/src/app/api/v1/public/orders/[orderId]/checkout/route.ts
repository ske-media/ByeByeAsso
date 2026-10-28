import { startCheckout } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { buyerTokenFrom, ticketingContext } from "@/lib/ticketing";

type Params = { orderId: string };

/**
 * POST — buyer: start payment. Free order → { kind: "paid" } ; otherwise { kind: "redirect", url }.
 * The success URL only shows a waiting page: tickets exist when the webhook has been processed.
 */
export const POST = apiRoute<Params>({ auth: "optional" }, async (ctx, { orderId }) => {
  const token = buyerTokenFrom(ctx.request);
  if (!token) return apiError(404, "not_found", "Commande introuvable.");
  const id = uuidSchema.parse(orderId);
  const base = `${env().APP_URL}/commande/${id}`;
  return ok(
    await startCheckout(db(), ticketingContext(), ctx.actor, id, token, {
      successUrl: `${base}/confirmation?k=${encodeURIComponent(token)}`,
      cancelUrl: `${base}?k=${encodeURIComponent(token)}&annule=1`,
    }),
  );
});
