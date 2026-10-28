import { listRequests } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — volunteers.review: ?status=open|all — unavailability / replacement requests to arbitrate. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const status = new URL(ctx.request.url).searchParams.get("status") === "all" ? "all" : "open";
  return ok(await listRequests(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId), status));
});
