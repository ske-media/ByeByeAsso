import { scanSchema, scanTicket } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string; eventId: string };

/**
 * POST — checkins.scan: { credential, device? } → { result, ticket, firstScan, counters }.
 * Atomic admission; every attempt is recorded. A ticket of another event is `invalid`.
 */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const input = await parseBody(ctx.request, scanSchema);
  return ok(
    await scanTicket(
      db(),
      ticketingContext(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(eventId),
      input.credential,
      input.device ?? null,
    ),
  );
});
