import { checkinSummary } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — checkins.scan: admitted / valid counters and the last scans. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await checkinSummary(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);
