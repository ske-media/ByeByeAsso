import { markUnderReview } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; versionId: string };

/** POST — volunteers.schedule: proposed/draft → under_review. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, versionId }) =>
  ok(await markUnderReview(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(versionId))),
);
