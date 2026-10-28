import { decideApplication, optionalReasonSchema, reasonSchema } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string; applicationId: string; action: string };

/** POST — volunteers.review. Actions: review · approve · waitlist · reject {reason}. Audited, e-mailed. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, applicationId, action }) => {
  if (!["review", "approve", "waitlist", "reject"].includes(action))
    return apiError(404, "not_found", "Action inconnue.");
  const decision = action as "review" | "approve" | "waitlist" | "reject";
  const body = await parseBody(ctx.request, decision === "reject" ? reasonSchema : optionalReasonSchema);
  return ok(
    await decideApplication(
      db(),
      ticketingContext(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(applicationId),
      decision,
      body.reason ?? undefined,
    ),
  );
});
