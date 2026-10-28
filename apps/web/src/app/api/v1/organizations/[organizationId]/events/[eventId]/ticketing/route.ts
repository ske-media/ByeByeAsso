import { getTicketingSettings, ticketingSettingsSchema, updateTicketingSettings } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — events.read: sales settings. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await getTicketingSettings(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);

/** PATCH — tickets.manage: open/close sales, max per order, sales close, nominative tickets. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const input = await parseBody(ctx.request, ticketingSettingsSchema);
  return ok(
    await updateTicketingSettings(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId), input),
  );
});
