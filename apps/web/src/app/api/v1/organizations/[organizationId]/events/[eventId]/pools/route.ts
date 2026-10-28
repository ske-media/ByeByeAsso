import { createPool, listPools, poolSchema } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await listPools(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);

/** POST — tickets.manage: shared capacity pool. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const input = await parseBody(ctx.request, poolSchema);
  const pool = await createPool(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId), input);
  return created(pool);
});
