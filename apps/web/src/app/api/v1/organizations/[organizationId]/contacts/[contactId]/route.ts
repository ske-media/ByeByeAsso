import { contactUpdateSchema, getContact, updateContact } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; contactId: string };

/** GET — contacts.read: 360° card (identities, consent journal, notes, history, merges). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, contactId }) => {
  return ok(await getContact(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(contactId)));
});

/** PATCH — contacts.manage: identity fields only (status, counters and consent are never patchable). */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, contactId }) => {
  const body = await parseBody(ctx.request, contactUpdateSchema);
  return ok(await updateContact(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(contactId), body));
});
