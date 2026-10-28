import { addNote, noteSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; contactId: string };

/** POST — contacts.manage: internal note (never exposed outside organizer routes). */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, contactId }) => {
  const body = await parseBody(ctx.request, noteSchema);
  return created(await addNote(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(contactId), body));
});
