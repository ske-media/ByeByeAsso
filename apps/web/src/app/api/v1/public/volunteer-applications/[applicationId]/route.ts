import {
  candidateEditableSchema,
  getApplicationForCandidate,
  updateApplicationByCandidate,
} from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { type ApiContext, apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { buyerTokenFrom, ticketingContext } from "@/lib/ticketing";

type Params = { applicationId: string };

function auth(ctx: ApiContext) {
  return {
    accessToken: buyerTokenFrom(ctx.request),
    actor: ctx.actor,
    email: ctx.user?.emailVerified ? ctx.user.email : undefined,
  };
}

/** GET — candidate (token via ?k= / Bearer, or the signed-in owner). Uniform 404. */
export const GET = apiRoute<Params>(
  { auth: "optional", rateLimit: { scope: "public.volunteers.read", limit: 120, windowSeconds: 60 } },
  async (ctx, { applicationId }) =>
    ok(await getApplicationForCandidate(db(), ticketingContext(), uuidSchema.parse(applicationId), auth(ctx)), {
      headers: { "Cache-Control": "no-store" },
    }),
);

/** PATCH — candidate: wishes, availabilities, skills, buddies, constraints, phone. Never the status. */
export const PATCH = apiRoute<Params>({ auth: "optional" }, async (ctx, { applicationId }) => {
  const input = await parseBody(ctx.request, candidateEditableSchema);
  return ok(
    await updateApplicationByCandidate(db(), ticketingContext(), uuidSchema.parse(applicationId), auth(ctx), input),
  );
});
