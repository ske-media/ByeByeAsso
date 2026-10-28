import { availabilityMatrix } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — volunteers.review: approved/waitlisted volunteers × active shifts (full / partial / none). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await availabilityMatrix(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);
