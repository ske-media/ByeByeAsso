import { applicationStats, listApplications, listApplicationsSchema } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — volunteers.review (event scope honoured): ?eventId&status&positionId&skillId&q + stats. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const input = listApplicationsSchema.parse({
    eventId: url.searchParams.get("eventId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    positionId: url.searchParams.get("positionId") ?? undefined,
    skillId: url.searchParams.get("skillId") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  const orgId = uuidSchema.parse(organizationId);
  const [applications, stats] = await Promise.all([
    listApplications(db(), ctx.actor, orgId, input),
    applicationStats(db(), ctx.actor, orgId, input.eventId),
  ]);
  return ok({ applications, stats });
});
