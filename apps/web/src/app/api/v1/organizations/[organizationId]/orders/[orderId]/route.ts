import { getOrder } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; orderId: string };

/** GET — orders.read at the order's event scope; 404 otherwise. Never returns buyer links. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, orderId }) =>
  ok(await getOrder(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(orderId))),
);
