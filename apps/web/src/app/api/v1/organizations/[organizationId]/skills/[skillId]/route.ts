import { archiveSkill, skillSchema, updateSkill } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; skillId: string };

/** PATCH — volunteers.review: full update. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, skillId }) => {
  const input = await parseBody(ctx.request, skillSchema);
  return ok(await updateSkill(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(skillId), input));
});

/** DELETE — volunteers.review: archive. */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, skillId }) => {
  await archiveSkill(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(skillId));
  return noContent();
});
