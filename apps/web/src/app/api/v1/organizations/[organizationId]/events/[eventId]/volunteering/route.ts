import { getVolunteering, updateVolunteering, volunteeringSettingsSchema } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — volunteers.review (event scope honoured): settings, questions, activated positions and shifts. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await getVolunteering(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);

/** PATCH — volunteers.schedule: recruitment status, target, rest rules, custom questions. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const input = await parseBody(ctx.request, volunteeringSettingsSchema);
  return ok(
    await updateVolunteering(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId), input),
  );
});
