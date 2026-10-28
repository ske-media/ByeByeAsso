import { createPromoCode, listPromoCodes, promoCodeSchema } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await listPromoCodes(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);

/** POST — tickets.manage: percent (basis points) or amount (minor units) discount. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const input = await parseBody(ctx.request, promoCodeSchema);
  return created(
    await createPromoCode(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId), input),
  );
});
