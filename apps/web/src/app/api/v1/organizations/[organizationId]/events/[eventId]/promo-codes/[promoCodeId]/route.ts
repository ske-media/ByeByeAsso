import { setPromoCodeActive } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiRoute, noContent, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; promoCodeId: string };

/** PATCH — tickets.manage: { active: boolean }. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId, promoCodeId }) => {
  const { active } = await parseBody(ctx.request, z.object({ active: z.boolean() }));
  await setPromoCodeActive(
    db(),
    ctx.actor,
    uuidSchema.parse(organizationId),
    uuidSchema.parse(eventId),
    uuidSchema.parse(promoCodeId),
    active,
  );
  return noContent();
});
