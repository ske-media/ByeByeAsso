import { listRuns } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — volunteers.review: engine runs of the event (newest first). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await listRuns(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);
