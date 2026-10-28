import { deleteDraftEvent, getEvent, updateEvent, updateEventSchema } from "@kroov/domain/events";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — events.read at event scope; 404 outside the actor's scope. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) =>
  ok(await getEvent(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId))),
);

/** PATCH — events.update; body carries `version` (optimistic concurrency, 409 stale_version). Audited. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const input = await parseBody(ctx.request, updateEventSchema);
  return ok(await updateEvent(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId), input));
});

/** DELETE — events.update; drafts only (412 otherwise). Audited. */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  await deleteDraftEvent(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId));
  return noContent();
});
