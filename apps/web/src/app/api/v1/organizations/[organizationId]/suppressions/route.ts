import { listSuppressions, suppressEmail, suppressionSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — contacts.read: ?scope=active|all. The list is consultable without re-subscribing anyone. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const scope = new URL(ctx.request.url).searchParams.get("scope") === "all" ? "all" : "active";
  return ok({ suppressions: await listSuppressions(db(), ctx.actor, uuidSchema.parse(organizationId), scope) });
});

/** POST — contacts.manage: exclude an address (idempotent). */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, suppressionSchema);
  return created(await suppressEmail(db(), ctx.actor, uuidSchema.parse(organizationId), body));
});
