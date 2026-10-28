import { archiveTeam, teamSchema, updateTeam } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; teamId: string };

/** PATCH — volunteers.review: full update. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, teamId }) => {
  const input = await parseBody(ctx.request, teamSchema);
  return ok(await updateTeam(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(teamId), input));
});

/** DELETE — volunteers.review: archive. */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, teamId }) => {
  await archiveTeam(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(teamId));
  return noContent();
});
