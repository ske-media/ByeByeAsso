import { createInvitation, createInvitationSchema, listInvitations } from "@kroov/domain/organizations";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { invitationContext } from "@/lib/email";

type Params = { organizationId: string };

/** GET /api/v1/organizations/{id}/invitations — members.invite. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await listInvitations(db(), ctx.actor, uuidSchema.parse(organizationId))),
);

/**
 * POST /api/v1/organizations/{id}/invitations — members.invite (owner role: owner only).
 * Body: { email, role, eventId? }. 409 if already member or pending. Sends the e-mail. Audited.
 */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const input = await parseBody(ctx.request, createInvitationSchema);
  const orgId = uuidSchema.parse(organizationId);
  const invitation = await createInvitation(db(), ctx.actor, invitationContext(), orgId, input);
  return created(invitation, `/organizations/${orgId}/invitations/${invitation.id}`);
});
