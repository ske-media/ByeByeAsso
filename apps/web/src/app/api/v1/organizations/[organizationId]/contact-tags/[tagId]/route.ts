import { deleteTag, tagSchema, updateTag } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; tagId: string };

/** PATCH — contacts.manage. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, tagId }) => {
  const body = await parseBody(ctx.request, tagSchema.partial());
  const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  return ok(await updateTag(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(tagId), patch));
});

/** DELETE — contacts.manage (assignments cascade). */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, tagId }) => {
  await deleteTag(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(tagId));
  return noContent();
});
