import { cancelEvent, cancelEventSchema } from "@kroov/domain/events";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

/** POST — events.cancel; body { version, reason }. Reason mandatory, audited, outbox `event.cancelled`. */
export const POST = apiRoute<{ organizationId: string; eventId: string }>(
  { auth: "required" },
  async (ctx, { organizationId, eventId }) => {
    const input = await parseBody(ctx.request, cancelEventSchema);
    return ok(await cancelEvent(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId), input));
  },
);
