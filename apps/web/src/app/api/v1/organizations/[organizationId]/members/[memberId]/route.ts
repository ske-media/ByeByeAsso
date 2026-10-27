import { removeMember } from "@kroov/domain/organizations";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent } from "@/lib/api";
import { db } from "@/lib/db";

/** DELETE /api/v1/organizations/{id}/members/{memberId} — members.manage; 412 on last owner. Audited. */
export const DELETE = apiRoute<{ organizationId: string; memberId: string }>(
  { auth: "required" },
  async (ctx, { organizationId, memberId }) => {
    const reason = new URL(ctx.request.url).searchParams.get("reason") ?? undefined;
    await removeMember(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(memberId), reason);
    return noContent();
  },
);
