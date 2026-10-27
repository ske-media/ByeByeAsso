import { setMemberRoles, setMemberRolesSchema } from "@kroov/domain/organizations";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

/**
 * PUT /api/v1/organizations/{id}/members/{memberId}/roles — members.manage.
 * Body: { grants: [{ role, eventId? }], reason? }. Replaces the grant set atomically.
 * 403 when touching the owner role without being owner; 412 on last owner. Audited.
 */
export const PUT = apiRoute<{ organizationId: string; memberId: string }>(
  { auth: "required" },
  async (ctx, { organizationId, memberId }) => {
    const body = await parseBody(ctx.request, setMemberRolesSchema);
    return ok(
      await setMemberRoles(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(memberId), body),
    );
  },
);
