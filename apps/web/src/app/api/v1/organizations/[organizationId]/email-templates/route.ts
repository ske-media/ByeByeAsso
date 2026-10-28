import { createTemplate, listTemplates, templateInputSchema } from "@kroov/domain/marketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET / POST — campaigns.manage: reusable e-mail templates (restricted Markdown). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  return ok({ templates: await listTemplates(db(), ctx.actor, uuidSchema.parse(organizationId)) });
});
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, templateInputSchema);
  return created(await createTemplate(db(), ctx.actor, uuidSchema.parse(organizationId), body));
});
