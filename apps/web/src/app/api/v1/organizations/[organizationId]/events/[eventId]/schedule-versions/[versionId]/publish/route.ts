import { publishSchema, publishVersion } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string; eventId: string; versionId: string };

/**
 * POST — schedules.publish: { expectedVersion, acknowledgeUnfilled?, notes? }.
 * 409 stale_version · 412 conflicts / unfilled / not_publishable. Validated on current data.
 */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, versionId }) => {
  const input = await parseBody(ctx.request, publishSchema);
  return ok(
    await publishVersion(
      db(),
      ticketingContext(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(versionId),
      input,
    ),
  );
});
