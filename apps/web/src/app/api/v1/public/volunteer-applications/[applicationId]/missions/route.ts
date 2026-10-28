import { listMissions } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { buyerTokenFrom } from "@/lib/ticketing";

type Params = { applicationId: string };

/** GET — candidate: published missions only (never a draft, never other volunteers). */
export const GET = apiRoute<Params>({ auth: "optional" }, async (ctx, { applicationId }) =>
  ok(
    await listMissions(db(), uuidSchema.parse(applicationId), {
      accessToken: buyerTokenFrom(ctx.request),
      actor: ctx.actor,
      email: ctx.user?.emailVerified ? ctx.user.email : undefined,
    }),
    { headers: { "Cache-Control": "no-store" } },
  ),
);
