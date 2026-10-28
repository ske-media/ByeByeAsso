import { getRun } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; runId: string };

/** GET — volunteers.review: one run with its diagnostics (snapshot hash, weights, score, unfilled reasons). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, runId }) =>
  ok(await getRun(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(runId))),
);
