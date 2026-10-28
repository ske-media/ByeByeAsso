import { listMemberships, listMembershipsSchema, membershipStats } from "@kroov/domain/memberships";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — memberships.manage: ?status (incl. to_renew)&planId&q + stats. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const input = listMembershipsSchema.parse({
    status: url.searchParams.get("status") ?? undefined,
    planId: url.searchParams.get("planId") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  const orgId = uuidSchema.parse(organizationId);
  const [memberships, stats] = await Promise.all([
    listMemberships(db(), ctx.actor, orgId, input),
    membershipStats(db(), ctx.actor, orgId),
  ]);
  return ok({ memberships, stats });
});
