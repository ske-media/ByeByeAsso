import { createSegment, listSegments, segmentInputSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — contacts.read. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  return ok({ segments: await listSegments(db(), ctx.actor, uuidSchema.parse(organizationId)) });
});

/** POST — contacts.manage: dynamic (rules) or static segment. References are checked against the organization. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, segmentInputSchema);
  return created(await createSegment(db(), ctx.actor, uuidSchema.parse(organizationId), body));
});
