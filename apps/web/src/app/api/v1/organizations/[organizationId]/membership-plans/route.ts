import { createMembershipPlan, listMembershipPlans, membershipPlanSchema } from "@kroov/domain/memberships";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — memberships.manage: plans with quota counters. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await listMembershipPlans(db(), ctx.actor, uuidSchema.parse(organizationId))),
);

/** POST — memberships.manage: create a plan (fixed season or rolling duration). */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const input = await parseBody(ctx.request, membershipPlanSchema);
  const orgId = uuidSchema.parse(organizationId);
  const plan = await createMembershipPlan(db(), ctx.actor, orgId, input);
  return created(plan, `/organizations/${orgId}/membership-plans/${plan.id}`);
});
