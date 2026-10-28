import { activateEventPosition, eventPositionSchema } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** POST — volunteers.schedule: activate a template position on the event (idempotent). */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const input = await parseBody(ctx.request, eventPositionSchema);
  const orgId = uuidSchema.parse(organizationId);
  const evId = uuidSchema.parse(eventId);
  const position = await activateEventPosition(db(), ctx.actor, orgId, evId, input);
  return created(position, `/organizations/${orgId}/events/${evId}/volunteer-positions/${position.id}`);
});
