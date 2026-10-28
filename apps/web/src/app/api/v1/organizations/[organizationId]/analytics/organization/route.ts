import { organizationDashboard } from "@kroov/domain/analytics";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

const periodSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** GET — analytics.read: organization dashboard computed from the authoritative records (optional ?from&to). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const p = periodSchema.parse(Object.fromEntries(url.searchParams.entries()));
  return ok(
    await organizationDashboard(db(), ctx.actor, uuidSchema.parse(organizationId), {
      from: p.from ?? null,
      to: p.to ?? null,
    }),
  );
});
