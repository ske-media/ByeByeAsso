import { getPreferences, setPreferences, setPreferencesSchema } from "@kroov/domain/notifications";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — the caller's in-app preferences per notification kind (defaults to enabled). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  return ok({ preferences: await getPreferences(db(), ctx.actor, uuidSchema.parse(organizationId)) });
});

/** PUT { preferences: [{ kind, inApp }] } — upserts the caller's preferences. */
export const PUT = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, setPreferencesSchema);
  return ok({ preferences: await setPreferences(db(), ctx.actor, uuidSchema.parse(organizationId), body) });
});
