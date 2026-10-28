import { archiveSegment, getSegment, segmentUpdateSchema, updateSegment } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; segmentId: string };

/** GET — contacts.read: segment + live evaluation (dynamic) or stored members (static). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, segmentId }) => {
  return ok(await getSegment(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(segmentId)));
});

/** PATCH — contacts.manage (version = optimistic token). */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, segmentId }) => {
  const body = await parseBody(ctx.request, segmentUpdateSchema);
  return ok(await updateSegment(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(segmentId), body));
});

/** DELETE — contacts.manage: archive. */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, segmentId }) => {
  await archiveSegment(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(segmentId));
  return noContent();
});
