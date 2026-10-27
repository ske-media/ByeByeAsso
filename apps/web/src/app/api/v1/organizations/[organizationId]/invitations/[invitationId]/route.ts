import { revokeInvitation } from "@kroov/domain/organizations";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent } from "@/lib/api";
import { db } from "@/lib/db";

/** DELETE /api/v1/organizations/{id}/invitations/{invitationId} — members.invite; revokes a pending invitation. Audited. */
export const DELETE = apiRoute<{ organizationId: string; invitationId: string }>(
  { auth: "required" },
  async (ctx, { organizationId, invitationId }) => {
    const reason = new URL(ctx.request.url).searchParams.get("reason") ?? undefined;
    await revokeInvitation(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(invitationId), reason);
    return noContent();
  },
);
