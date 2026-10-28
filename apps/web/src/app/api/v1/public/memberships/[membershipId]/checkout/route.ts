import { startMembershipCheckout } from "@kroov/domain/memberships";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { buyerTokenFrom, ticketingContext } from "@/lib/ticketing";

type Params = { membershipId: string };

/** POST — member: hosted payment session for the cotisation. Activation happens on the webhook. */
export const POST = apiRoute<Params>({ auth: "optional" }, async (ctx, { membershipId }) => {
  const token = buyerTokenFrom(ctx.request);
  if (!token) return apiError(404, "not_found", "Adhésion introuvable.");
  const id = uuidSchema.parse(membershipId);
  const base = `${env().APP_URL}/adhesion/${id}`;
  return ok(
    await startMembershipCheckout(db(), ticketingContext(), ctx.actor, id, token, {
      successUrl: `${base}/confirmation?k=${encodeURIComponent(token)}`,
      cancelUrl: `${base}?k=${encodeURIComponent(token)}&annule=1`,
    }),
  );
});
