import { setContactTags, setTagsSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; contactId: string };

/** PUT — contacts.manage: replace the contact's tag list. */
export const PUT = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, contactId }) => {
  const body = await parseBody(ctx.request, setTagsSchema);
  return ok({
    tags: await setContactTags(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(contactId), body),
  });
});
