import { renewMembership, renewSchema } from "@kroov/domain/memberships";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, created, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { buyerTokenFrom, ticketingContext } from "@/lib/ticketing";

type Params = { membershipId: string };

/** POST — member: { planId } → new linked membership (same approval and payment rules). */
export const POST = apiRoute<Params>({ auth: "optional" }, async (ctx, { membershipId }) => {
  const token = buyerTokenFrom(ctx.request);
  if (!token) return apiError(404, "not_found", "Adhésion introuvable.");
  const { planId } = await parseBody(ctx.request, renewSchema);
  return created(
    await renewMembership(db(), ticketingContext(), ctx.actor, uuidSchema.parse(membershipId), token, planId),
  );
});
