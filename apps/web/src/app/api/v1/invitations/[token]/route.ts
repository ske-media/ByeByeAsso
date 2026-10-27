import { getInvitationByToken } from "@kroov/domain/organizations";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/v1/invitations/{token} — public, minimal data (organization name, role, masked e-mail, status). 404 for unknown tokens. */
export const GET = apiRoute<{ token: string }>({ auth: "optional" }, async (_ctx, { token }) => {
  const { email: _email, ...publicView } = await getInvitationByToken(db(), token);
  return ok(publicView, { headers: { "Cache-Control": "no-store" } });
});
