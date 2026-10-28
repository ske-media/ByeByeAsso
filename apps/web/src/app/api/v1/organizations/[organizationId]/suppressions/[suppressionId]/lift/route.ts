import { liftSuppression, liftSuppressionSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; suppressionId: string };

/** POST — contacts.manage: lift an exclusion, reason mandatory (never automatic). */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, suppressionId }) => {
  const body = await parseBody(ctx.request, liftSuppressionSchema);
  await liftSuppression(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(suppressionId), body);
  return ok({ lifted: true });
});
