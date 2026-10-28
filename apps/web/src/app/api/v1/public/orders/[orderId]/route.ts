import { buyerDetailsSchema, getOrderForBuyer, updateBuyerDetails } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { buyerTokenFrom, ticketingContext } from "@/lib/ticketing";

type Params = { orderId: string };

/** GET — buyer (access token via ?k= or Bearer, or the signed-in owner). Uniform 404. */
export const GET = apiRoute<Params>({ auth: "optional" }, async (ctx, { orderId }) =>
  ok(
    await getOrderForBuyer(db(), ticketingContext(), uuidSchema.parse(orderId), {
      accessToken: buyerTokenFrom(ctx.request),
      actor: ctx.actor,
    }),
    { headers: { "Cache-Control": "no-store" } },
  ),
);

/** PATCH — buyer: e-mail, names, attendees, opt-in. Only while the order is unpaid and unexpired. */
export const PATCH = apiRoute<Params>({ auth: "optional" }, async (ctx, { orderId }) => {
  const token = buyerTokenFrom(ctx.request);
  if (!token) return apiError(404, "not_found", "Commande introuvable.");
  const input = await parseBody(ctx.request, buyerDetailsSchema);
  return ok(await updateBuyerDetails(db(), ticketingContext(), uuidSchema.parse(orderId), token, input));
});
