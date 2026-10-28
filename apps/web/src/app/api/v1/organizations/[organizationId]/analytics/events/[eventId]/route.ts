import { eventDashboard } from "@kroov/domain/analytics";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — analytics.read (or event-scoped events.read): event dashboard. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  return ok(await eventDashboard(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId)));
});
