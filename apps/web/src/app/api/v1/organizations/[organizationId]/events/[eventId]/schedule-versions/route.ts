import { createVersion, createVersionSchema, listVersions } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — volunteers.review: versions of the event's schedule with coverage. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await listVersions(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);

/** POST — volunteers.schedule: new draft version, optionally copied from another one. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const input = await parseBody(ctx.request, createVersionSchema);
  const orgId = uuidSchema.parse(organizationId);
  const evId = uuidSchema.parse(eventId);
  const version = await createVersion(db(), ctx.actor, orgId, evId, input);
  return created(version, `/organizations/${orgId}/events/${evId}/schedule-versions/${version.id}`);
});
