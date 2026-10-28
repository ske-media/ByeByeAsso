import { financeOverview } from "@kroov/domain/analytics";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — analytics.read: ledger balances, per-event detail, journal (?limit), documents; payouts explicitly unavailable. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .parse(url.searchParams.get("limit") ?? undefined);
  return ok(await financeOverview(db(), ctx.actor, uuidSchema.parse(organizationId), limit));
});
