import { deletePool } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; poolId: string };

export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId, poolId }) => {
  await deletePool(
    db(),
    ctx.actor,
    uuidSchema.parse(organizationId),
    uuidSchema.parse(eventId),
    uuidSchema.parse(poolId),
  );
  return noContent();
});
