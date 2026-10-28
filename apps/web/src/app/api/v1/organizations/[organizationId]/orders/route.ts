import { listOrders, listOrdersSchema, ticketingStats } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — orders.read: ?eventId&status&q (+ stats). Abandoned reservations without details are omitted. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const input = listOrdersSchema.parse({
    eventId: url.searchParams.get("eventId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  const orgId = uuidSchema.parse(organizationId);
  const [orders, stats] = await Promise.all([
    listOrders(db(), ctx.actor, orgId, input),
    ticketingStats(db(), ctx.actor, orgId, input.eventId),
  ]);
  return ok({ orders, stats });
});
