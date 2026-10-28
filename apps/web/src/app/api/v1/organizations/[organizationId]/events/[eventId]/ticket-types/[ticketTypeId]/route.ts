import { archiveTicketType, updateTicketType, updateTicketTypeSchema } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; ticketTypeId: string };

/** PATCH — tickets.manage. Price changes affect future orders only (snapshots in order_items). */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId, ticketTypeId }) => {
  const input = await parseBody(ctx.request, updateTicketTypeSchema);
  return ok(
    await updateTicketType(
      db(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(eventId),
      uuidSchema.parse(ticketTypeId),
      input,
    ),
  );
});

/** DELETE — tickets.manage: archive (412 while reservations use it). */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId, ticketTypeId }) => {
  await archiveTicketType(
    db(),
    ctx.actor,
    uuidSchema.parse(organizationId),
    uuidSchema.parse(eventId),
    uuidSchema.parse(ticketTypeId),
  );
  return noContent();
});
