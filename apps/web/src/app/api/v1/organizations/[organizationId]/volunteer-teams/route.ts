import { createTeam, listTeams, teamSchema } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — volunteers.review: équipes of the organization. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await listTeams(db(), ctx.actor, uuidSchema.parse(organizationId))),
);

/** POST — volunteers.review: create. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const input = await parseBody(ctx.request, teamSchema);
  const orgId = uuidSchema.parse(organizationId);
  const item = await createTeam(db(), ctx.actor, orgId, input);
  return created(item, `/organizations/${orgId}/volunteer-teams/${item.id}`);
});
