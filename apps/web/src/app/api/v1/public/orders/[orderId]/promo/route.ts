import { applyPromoCode, applyPromoSchema } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { buyerTokenFrom, ticketingContext } from "@/lib/ticketing";

type Params = { orderId: string };

/** POST — buyer: { code }. 412 promo_invalid / promo_exhausted. */
export const POST = apiRoute<Params>({ auth: "optional" }, async (ctx, { orderId }) => {
  const token = buyerTokenFrom(ctx.request);
  if (!token) return apiError(404, "not_found", "Commande introuvable.");
  const { code } = await parseBody(ctx.request, applyPromoSchema);
  return ok(await applyPromoCode(db(), ticketingContext(), uuidSchema.parse(orderId), token, code));
});
