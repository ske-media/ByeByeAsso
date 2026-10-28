import { bulkDecide, bulkDecisionSchema } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string };

/** POST — volunteers.review: { ids, action, reason? } → one result per record (never all-or-nothing). */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const input = await parseBody(ctx.request, bulkDecisionSchema);
  return ok(await bulkDecide(db(), ticketingContext(), ctx.actor, uuidSchema.parse(organizationId), input));
});
