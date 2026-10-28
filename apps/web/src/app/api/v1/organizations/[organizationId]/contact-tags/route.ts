import { createTag, listTags, tagSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — contacts.read. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  return ok({ tags: await listTags(db(), ctx.actor, uuidSchema.parse(organizationId)) });
});

/** POST — contacts.manage. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, tagSchema);
  return created(await createTag(db(), ctx.actor, uuidSchema.parse(organizationId), body));
});
