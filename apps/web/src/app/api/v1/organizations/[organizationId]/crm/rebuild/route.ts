import { rebuildContacts } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** POST — contacts.manage: replay orders, memberships and applications into the contact base (idempotent). */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  return ok(await rebuildContacts(db(), ctx.actor, uuidSchema.parse(organizationId)));
});
