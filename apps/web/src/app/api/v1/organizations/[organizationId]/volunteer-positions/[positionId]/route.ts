import { archivePosition, positionSchema, updatePosition } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; positionId: string };

/** PATCH — volunteers.review: full update. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, positionId }) => {
  const input = await parseBody(ctx.request, positionSchema);
  return ok(
    await updatePosition(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(positionId), input),
  );
});

/** DELETE — volunteers.review: archive. */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, positionId }) => {
  await archivePosition(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(positionId));
  return noContent();
});
