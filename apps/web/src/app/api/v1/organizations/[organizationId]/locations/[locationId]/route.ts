import { archiveLocation, updateLocation, updateLocationSchema } from "@kroov/domain/events";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; locationId: string };

/** PATCH — events.update. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, locationId }) => {
  const input = await parseBody(ctx.request, updateLocationSchema);
  return ok(
    await updateLocation(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(locationId), input),
  );
});

/** DELETE — events.update: archive (events keep their reference). */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, locationId }) => {
  await archiveLocation(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(locationId));
  return noContent();
});
