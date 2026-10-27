import { acceptInvitation } from "@kroov/domain/organizations";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

/**
 * POST /api/v1/invitations/{token}/accept — session required, e-mail verified and matching.
 * 404 unknown token; 412 expired / already used / unverified e-mail; 403 e-mail mismatch. Audited.
 */
export const POST = apiRoute<{ token: string }>({ auth: "required" }, async (ctx, { token }) =>
  ok(await acceptInvitation(db(), ctx.actor, token)),
);
