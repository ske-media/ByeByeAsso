import { createTicketType, listTicketTypes, ticketTypeSchema } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — events.read: ticket types with live sold/held/available counters. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await listTicketTypes(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);

/** POST — tickets.manage: create a ticket type (price in minor units). Audited. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const input = await parseBody(ctx.request, ticketTypeSchema);
  const orgId = uuidSchema.parse(organizationId);
  const evId = uuidSchema.parse(eventId);
  const type = await createTicketType(db(), ctx.actor, orgId, evId, input);
  return created(type, `/organizations/${orgId}/events/${evId}/ticket-types/${type.id}`);
});
