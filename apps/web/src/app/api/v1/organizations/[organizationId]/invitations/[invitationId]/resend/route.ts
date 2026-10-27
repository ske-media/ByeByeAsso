import { resendInvitation } from "@kroov/domain/organizations";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { invitationContext } from "@/lib/email";

/** POST /api/v1/organizations/{id}/invitations/{invitationId}/resend — members.invite; new token + expiry. 412 if accepted/revoked. */
export const POST = apiRoute<{ organizationId: string; invitationId: string }>(
  { auth: "required" },
  async (ctx, { organizationId, invitationId }) =>
    ok(
      await resendInvitation(
        db(),
        ctx.actor,
        invitationContext(),
        uuidSchema.parse(organizationId),
        uuidSchema.parse(invitationId),
      ),
    ),
);
