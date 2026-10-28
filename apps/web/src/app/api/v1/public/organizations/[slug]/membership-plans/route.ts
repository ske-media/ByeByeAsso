import { getPublicOrganization } from "@kroov/domain/events";
import { listPublicMembershipPlans } from "@kroov/domain/memberships";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { slug: string };

/** GET — anonymous: active public plans with remaining places when capped. */
export const GET = apiRoute<Params>({ auth: "optional" }, async (_ctx, { slug }) => {
  const organization = await getPublicOrganization(db(), slug);
  const plans = await listPublicMembershipPlans(db(), organization.id);
  return ok(
    plans.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      priceMinor: p.priceMinor,
      currency: p.currency,
      periodKind: p.periodKind,
      validFrom: p.validFrom,
      validUntil: p.validUntil,
      durationMonths: p.durationMonths,
      requiresReview: p.requiresReview,
      benefits: p.benefits,
      remaining: p.maxMembers === null ? null : Math.max(0, p.maxMembers - p.taken),
    })),
    { headers: { "Cache-Control": "no-store" } },
  );
});
