import { resolveRequest, resolveRequestSchema } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, noContent, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; requestId: string; action: string };

/** POST — volunteers.schedule: resolve | dismiss { resolution }. Dismiss keeps the volunteer on the mission. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, requestId, action }) => {
  if (action !== "resolve" && action !== "dismiss") return apiError(404, "not_found", "Action inconnue.");
  const { resolution } = await parseBody(ctx.request, resolveRequestSchema);
  await resolveRequest(
    db(),
    ctx.actor,
    uuidSchema.parse(organizationId),
    uuidSchema.parse(requestId),
    action === "resolve" ? "resolved" : "dismissed",
    resolution,
  );
  return noContent();
});
