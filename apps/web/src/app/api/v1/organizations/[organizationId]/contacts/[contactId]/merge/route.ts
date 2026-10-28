import { mergeContacts, mergeSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; contactId: string };

/** POST — contacts.manage: merge `mergedContactId` INTO this contact (survivor). Irreversible, snapshot kept. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, contactId }) => {
  const body = await parseBody(ctx.request, mergeSchema);
  return ok(await mergeContacts(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(contactId), body));
});
