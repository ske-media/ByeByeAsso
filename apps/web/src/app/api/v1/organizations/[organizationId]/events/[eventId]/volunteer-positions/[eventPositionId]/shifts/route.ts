import { createShift, shiftSchema } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; eventPositionId: string };

/** POST — volunteers.schedule: a shift (within the event window ± 1 day, ≤ 24 h, 0 ≤ required ≤ max). */
export const POST = apiRoute<Params>(
  { auth: "required" },
  async (ctx, { organizationId, eventId, eventPositionId }) => {
    const input = await parseBody(ctx.request, shiftSchema);
    const orgId = uuidSchema.parse(organizationId);
    const evId = uuidSchema.parse(eventId);
    const shift = await createShift(db(), ctx.actor, orgId, evId, uuidSchema.parse(eventPositionId), input);
    return created(
      shift,
      `/organizations/${orgId}/events/${evId}/volunteer-positions/${eventPositionId}/shifts/${shift.id}`,
    );
  },
);
