import { deleteAccount, deleteAccountSchema } from "@kroov/domain/privacy";
import { headers } from "next/headers";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/v1/profiles/me/delete { confirmEmail } — deletes the signed-in person's account by
 * anonymisation. 412 `last_owner` while they are the only owner of an organization. Every
 * session row is purged server-side and the caller's cookies are cleared in the response
 * (the short-lived session cookie cache cannot outlive this response on this device).
 */
export const POST = apiRoute({ auth: "required" }, async (ctx) => {
  const body = await parseBody(ctx.request, deleteAccountSchema);
  const result = await deleteAccount(db(), ctx.actor, body);
  const response = ok(result);
  // Better Auth clears its cookies even when the session row is already gone.
  const signedOut = await auth()
    .api.signOut({ headers: await headers(), asResponse: true })
    .catch(() => null);
  for (const cookie of signedOut?.headers.getSetCookie() ?? []) response.headers.append("set-cookie", cookie);
  return response;
});
