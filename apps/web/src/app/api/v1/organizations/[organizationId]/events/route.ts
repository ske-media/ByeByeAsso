import { createEvent, createEventSchema, listEvents, listEventsSchema } from "@kroov/domain/events";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET /api/v1/organizations/{id}/events?status=active|all|draft|… — events.read (org-wide or scoped). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const input = listEventsSchema.parse({
    status: url.searchParams.get("status") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  return ok(await listEvents(db(), ctx.actor, uuidSchema.parse(organizationId), input));
});

/** POST /api/v1/organizations/{id}/events — events.create. Dates as ISO instants; auto slug from title. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const input = await parseBody(ctx.request, createEventSchema);
  const orgId = uuidSchema.parse(organizationId);
  const event = await createEvent(db(), ctx.actor, orgId, input);
  return created(event, `/organizations/${orgId}/events/${event.id}`);
});
