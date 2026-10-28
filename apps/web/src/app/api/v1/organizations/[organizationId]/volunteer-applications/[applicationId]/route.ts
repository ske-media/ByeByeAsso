import { getApplication, staffApplicationPatchSchema, updateApplicationByStaff } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; applicationId: string };

/** GET — volunteers.review: full staff view (internal notes, buddy resolution, shift coverage). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, applicationId }) =>
  ok(await getApplication(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(applicationId))),
);

/** PATCH — volunteers.review: identity, wishes, availabilities, skills (+ verified ids), buddies, internal notes. `status` is never patchable. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, applicationId }) => {
  const input = await parseBody(ctx.request, staffApplicationPatchSchema);
  return ok(
    await updateApplicationByStaff(
      db(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(applicationId),
      input,
    ),
  );
});
