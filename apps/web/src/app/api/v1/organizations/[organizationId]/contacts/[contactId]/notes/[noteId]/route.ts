import { deleteNote } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; contactId: string; noteId: string };

/** DELETE — contacts.manage. */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, contactId, noteId }) => {
  await deleteNote(
    db(),
    ctx.actor,
    uuidSchema.parse(organizationId),
    uuidSchema.parse(contactId),
    uuidSchema.parse(noteId),
  );
  return noContent();
});
