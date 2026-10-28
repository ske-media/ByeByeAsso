import { resendOrderEmail } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string; orderId: string };

/** POST — orders.read: rotate the buyer links and send the confirmation again. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, orderId }) => {
  await resendOrderEmail(
    db(),
    ticketingContext(),
    ctx.actor,
    uuidSchema.parse(organizationId),
    uuidSchema.parse(orderId),
  );
  return noContent();
});
