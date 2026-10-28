import { createPosition, listPositions, positionSchema } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — volunteers.review: postes types of the organization. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await listPositions(db(), ctx.actor, uuidSchema.parse(organizationId))),
);

/** POST — volunteers.review: create. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const input = await parseBody(ctx.request, positionSchema);
  const orgId = uuidSchema.parse(organizationId);
  const item = await createPosition(db(), ctx.actor, orgId, input);
  return created(item, `/organizations/${orgId}/volunteer-positions/${item.id}`);
});
