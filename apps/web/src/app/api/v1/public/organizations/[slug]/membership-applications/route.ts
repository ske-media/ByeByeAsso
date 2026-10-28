import { applyForMembership, membershipApplicationSchema } from "@kroov/domain/memberships";
import { apiRoute, created, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { slug: string };

/**
 * POST — anonymous or signed-in: apply for a plan. Returns the membership with its `accessToken`
 * (only time it is sent). 409 membership_exists / application_in_progress · 412 plan_full.
 */
export const POST = apiRoute<Params>(
  { auth: "optional", rateLimit: { scope: "public.memberships.apply", limit: 10, windowSeconds: 60 } },
  async (ctx, { slug }) => {
    const input = await parseBody(ctx.request, membershipApplicationSchema);
    return created(await applyForMembership(db(), ticketingContext(), ctx.actor, slug, input));
  },
);
