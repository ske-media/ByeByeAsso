import { previewSegment, segmentDefinitionSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** POST — contacts.read: evaluate a definition now → { count, consented, sample, computedAt }. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, segmentDefinitionSchema);
  return ok(await previewSegment(db(), ctx.actor, uuidSchema.parse(organizationId), body));
});
