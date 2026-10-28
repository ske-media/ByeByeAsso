import {
  archiveMembershipPlan,
  getMembershipPlan,
  membershipPlanSchema,
  updateMembershipPlan,
} from "@kroov/domain/memberships";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; planId: string };

export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, planId }) =>
  ok(await getMembershipPlan(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(planId))),
);

/** PATCH — memberships.manage: full update (benefits replaced). */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, planId }) => {
  const input = await parseBody(ctx.request, membershipPlanSchema);
  return ok(
    await updateMembershipPlan(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(planId), input),
  );
});

/** DELETE — memberships.manage: archive (existing memberships keep their validity). */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, planId }) => {
  await archiveMembershipPlan(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(planId));
  return noContent();
});
