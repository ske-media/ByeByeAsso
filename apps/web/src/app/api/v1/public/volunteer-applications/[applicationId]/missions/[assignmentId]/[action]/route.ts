import { confirmMission, reportUnavailable, reportUnavailableSchema } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { buyerTokenFrom, ticketingContext } from "@/lib/ticketing";

type Params = { applicationId: string; assignmentId: string; action: string };

/** POST — candidate: confirm | report-unavailable { message? }. A report never removes the mission by itself. */
export const POST = apiRoute<Params>({ auth: "optional" }, async (ctx, { applicationId, assignmentId, action }) => {
  const auth = {
    accessToken: buyerTokenFrom(ctx.request),
    actor: ctx.actor,
    email: ctx.user?.emailVerified ? ctx.user.email : undefined,
  };
  const appId = uuidSchema.parse(applicationId);
  const asgId = uuidSchema.parse(assignmentId);
  if (action === "confirm") return ok(await confirmMission(db(), appId, auth, asgId));
  if (action === "report-unavailable") {
    const { message } = await parseBody(ctx.request, reportUnavailableSchema);
    return ok(await reportUnavailable(db(), ticketingContext(), appId, auth, asgId, message ?? undefined));
  }
  return apiError(404, "not_found", "Action inconnue.");
});
