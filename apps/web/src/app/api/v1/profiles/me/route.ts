import { getProfile, updateProfile, updateProfileSchema } from "@kroov/domain/identity";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/v1/profiles/me — session required. */
export const GET = apiRoute({ auth: "required" }, async (ctx) => ok(await getProfile(db(), ctx.actor)));

/** PATCH /api/v1/profiles/me — session required; body: { name?, timezone?, phone? }. */
export const PATCH = apiRoute({ auth: "required" }, async (ctx) => {
  const input = await parseBody(ctx.request, updateProfileSchema);
  return ok(await updateProfile(db(), ctx.actor, input));
});
