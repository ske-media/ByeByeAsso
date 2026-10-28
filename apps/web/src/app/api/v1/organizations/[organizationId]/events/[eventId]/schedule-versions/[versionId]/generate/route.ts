import { generateSchema, generateVersion } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; versionId: string };

/** POST — volunteers.schedule: run the engine (inline, bounded, journaled). { shiftIds?, weights? } */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, versionId }) => {
  const input = await parseBody(ctx.request, generateSchema);
  const { version, run, output } = await generateVersion(
    db(),
    ctx.actor,
    uuidSchema.parse(organizationId),
    uuidSchema.parse(versionId),
    input,
  );
  return ok({ version, run, unfilled: output.unfilled, invalidLocks: output.invalidLocks, score: output.score });
});
