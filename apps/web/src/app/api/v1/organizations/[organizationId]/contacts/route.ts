import { contactInputSchema, createContact, listContacts, listContactsSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — contacts.read: ?q&status&marketing&tagId&source&eventId&segmentId&sort&page&pageSize → { contacts, total, stats }. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const input = listContactsSchema.parse(Object.fromEntries(url.searchParams.entries()));
  return ok(await listContacts(db(), ctx.actor, uuidSchema.parse(organizationId), input));
});

/** POST — contacts.manage: create a contact by hand (409 if the address is already a live contact). */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, contactInputSchema);
  return created(await createContact(db(), ctx.actor, uuidSchema.parse(organizationId), body));
});
