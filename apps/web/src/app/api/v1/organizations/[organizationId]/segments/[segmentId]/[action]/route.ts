import { recomputeSegment, segmentMembersSchema, setStaticMembers } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; segmentId: string; action: string };

/** POST — evaluate (contacts.read, dynamic: recompute and store the count) · members (contacts.manage, static: {add, remove}). */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, segmentId, action }) => {
  const orgId = uuidSchema.parse(organizationId);
  const id = uuidSchema.parse(segmentId);
  if (action === "evaluate") return ok(await recomputeSegment(db(), ctx.actor, orgId, id));
  if (action === "members") {
    const body = await parseBody(ctx.request, segmentMembersSchema);
    return ok(await setStaticMembers(db(), ctx.actor, orgId, id, body));
  }
  return apiError(404, "not_found", "Action inconnue.");
});
