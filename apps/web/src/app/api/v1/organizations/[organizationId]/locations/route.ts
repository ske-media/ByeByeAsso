import { createLocation, listLocations, locationSchema } from "@kroov/domain/events";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — events.read: active venues. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await listLocations(db(), ctx.actor, uuidSchema.parse(organizationId))),
);

/** POST — events.update: create a venue. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const input = await parseBody(ctx.request, locationSchema);
  const orgId = uuidSchema.parse(organizationId);
  const location = await createLocation(db(), ctx.actor, orgId, input);
  return created(location, `/organizations/${orgId}/locations/${location.id}`);
});
