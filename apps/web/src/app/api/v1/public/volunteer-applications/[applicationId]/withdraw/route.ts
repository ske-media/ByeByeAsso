import { optionalReasonSchema, withdrawApplication } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { buyerTokenFrom, ticketingContext } from "@/lib/ticketing";

type Params = { applicationId: string };

/** POST — candidate: withdraw (final). { reason? } */
export const POST = apiRoute<Params>({ auth: "optional" }, async (ctx, { applicationId }) => {
  const { reason } = await parseBody(ctx.request, optionalReasonSchema);
  return ok(
    await withdrawApplication(
      db(),
      ticketingContext(),
      uuidSchema.parse(applicationId),
      {
        accessToken: buyerTokenFrom(ctx.request),
        actor: ctx.actor,
        email: ctx.user?.emailVerified ? ctx.user.email : undefined,
      },
      reason ?? undefined,
    ),
  );
});
