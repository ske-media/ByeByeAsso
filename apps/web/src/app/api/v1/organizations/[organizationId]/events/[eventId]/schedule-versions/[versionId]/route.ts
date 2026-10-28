import { getVersion } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; versionId: string };

/** GET — volunteers.review: assignments, conflicts (on current data), unfilled, candidates per shift, last run. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, versionId }) =>
  ok(await getVersion(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(versionId))),
);
