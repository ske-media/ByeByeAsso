import {
  approveMembership,
  cancelMembership,
  extendMembership,
  extendValiditySchema,
  reactivateMembership,
  reasonSchema,
  rejectMembership,
  resendMembershipLink,
  suspendMembership,
} from "@kroov/domain/memberships";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string; membershipId: string; action: string };

/**
 * POST — memberships.manage. Actions: approve · reject {reason} · suspend {reason} · reactivate ·
 * cancel {reason} · extend {validUntil, reason} · resend. Every transition is audited; validity
 * changes are appended to the immutable history.
 */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, membershipId, action }) => {
  const orgId = uuidSchema.parse(organizationId);
  const id = uuidSchema.parse(membershipId);
  const tctx = ticketingContext();
  switch (action) {
    case "approve":
      return ok(await approveMembership(db(), tctx, ctx.actor, orgId, id));
    case "reject":
      return ok(
        await rejectMembership(db(), tctx, ctx.actor, orgId, id, (await parseBody(ctx.request, reasonSchema)).reason),
      );
    case "suspend":
      return ok(
        await suspendMembership(db(), tctx, ctx.actor, orgId, id, (await parseBody(ctx.request, reasonSchema)).reason),
      );
    case "reactivate":
      return ok(await reactivateMembership(db(), tctx, ctx.actor, orgId, id));
    case "cancel":
      return ok(
        await cancelMembership(db(), tctx, ctx.actor, orgId, id, (await parseBody(ctx.request, reasonSchema)).reason),
      );
    case "extend":
      return ok(
        await extendMembership(db(), tctx, ctx.actor, orgId, id, await parseBody(ctx.request, extendValiditySchema)),
      );
    case "resend":
      await resendMembershipLink(db(), tctx, ctx.actor, orgId, id);
      return noContent();
    default:
      return apiError(404, "not_found", "Action inconnue.");
  }
});
