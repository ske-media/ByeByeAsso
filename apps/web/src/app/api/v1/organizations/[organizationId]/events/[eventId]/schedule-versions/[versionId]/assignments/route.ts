import { assignSchema, assignVolunteer } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; versionId: string };

/** POST — volunteers.schedule: { shiftId, applicationId, lock? } — 412 hard_constraint with the reason. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, versionId }) => {
  const input = await parseBody(ctx.request, assignSchema);
  return created(
    await assignVolunteer(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(versionId), input),
  );
});
