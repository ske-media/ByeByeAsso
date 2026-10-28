import { getMembershipForMember } from "@kroov/domain/memberships";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { buyerTokenFrom, ticketingContext } from "@/lib/ticketing";

type Params = { membershipId: string };

/** GET — member (token via ?k= / Bearer, or the signed-in owner). Uniform 404. */
export const GET = apiRoute<Params>(
  { auth: "optional", rateLimit: { scope: "public.memberships.read", limit: 120, windowSeconds: 60 } },
  async (ctx, { membershipId }) =>
    ok(
      await getMembershipForMember(db(), ticketingContext(), uuidSchema.parse(membershipId), {
        accessToken: buyerTokenFrom(ctx.request),
        actor: ctx.actor,
        email: ctx.user?.emailVerified ? ctx.user.email : undefined,
      }),
      { headers: { "Cache-Control": "no-store" } },
    ),
);
