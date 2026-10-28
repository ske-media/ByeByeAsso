import { createPublicOrder, createPublicOrderSchema } from "@kroov/domain/ticketing";
import { apiRoute, created, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

/**
 * POST — anonymous or signed-in: reserve seats (10 min). Returns the order with its
 * `accessToken` — the only time the token is sent in a response; keep it client-side.
 */
export const POST = apiRoute(
  { auth: "optional", rateLimit: { scope: "public.orders.create", limit: 30, windowSeconds: 60 } },
  async (ctx) => {
    const input = await parseBody(ctx.request, createPublicOrderSchema);
    const order = await createPublicOrder(db(), ticketingContext(), ctx.actor, input);
    return created(order);
  },
);
