import { applyAsVolunteer, volunteerApplicationSchema } from "@kroov/domain/volunteers";
import { apiRoute, created, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { slug: string; eventSlug: string };

/**
 * POST — anonymous or signed-in: apply as a volunteer. Returns the application with its
 * `accessToken` (only time it is sent). 409 application_exists · 412 recruitment_closed · 422 fieldErrors.
 */
export const POST = apiRoute<Params>(
  { auth: "optional", rateLimit: { scope: "public.volunteers.apply", limit: 10, windowSeconds: 60 } },
  async (ctx, { slug, eventSlug }) => {
    const input = await parseBody(ctx.request, volunteerApplicationSchema);
    return created(await applyAsVolunteer(db(), ticketingContext(), ctx.actor, slug, eventSlug, input));
  },
);
