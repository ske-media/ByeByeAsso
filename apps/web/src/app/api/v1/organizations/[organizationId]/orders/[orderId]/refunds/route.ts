import { createRefund, refundRequestSchema } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string; orderId: string };

/** POST — orders.refund: { ticketIds[] | full, reason }. Amount capped by what was collected. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, orderId }) => {
  const input = await parseBody(ctx.request, refundRequestSchema);
  return ok(
    await createRefund(
      db(),
      ticketingContext(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(orderId),
      input,
    ),
  );
});
