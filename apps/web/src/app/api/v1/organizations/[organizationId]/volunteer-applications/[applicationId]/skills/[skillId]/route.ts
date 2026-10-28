import { verifySkill } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; applicationId: string; skillId: string };

/** POST — volunteers.review: { verified: boolean } for a declared skill. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, applicationId, skillId }) => {
  const { verified } = await parseBody(ctx.request, z.object({ verified: z.boolean() }));
  return ok(
    await verifySkill(
      db(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(applicationId),
      uuidSchema.parse(skillId),
      verified,
    ),
  );
});
