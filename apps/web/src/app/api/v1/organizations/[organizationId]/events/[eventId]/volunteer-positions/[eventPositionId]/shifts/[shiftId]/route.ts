import { cancelShift, shiftSchema, updateShift } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; eventPositionId: string; shiftId: string };

/** PATCH — volunteers.schedule: full update of an active shift. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId, shiftId }) => {
  const input = await parseBody(ctx.request, shiftSchema);
  return ok(
    await updateShift(
      db(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(eventId),
      uuidSchema.parse(shiftId),
      input,
    ),
  );
});

/** DELETE — volunteers.schedule: cancel (never deleted; phase 6 keeps history). */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId, shiftId }) => {
  await cancelShift(
    db(),
    ctx.actor,
    uuidSchema.parse(organizationId),
    uuidSchema.parse(eventId),
    uuidSchema.parse(shiftId),
  );
  return noContent();
});
