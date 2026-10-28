import { archiveTemplate, templateUpdateSchema, updateTemplate } from "@kroov/domain/marketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; templateId: string };

export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, templateId }) => {
  const body = await parseBody(ctx.request, templateUpdateSchema);
  const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  return ok(
    await updateTemplate(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(templateId), patch),
  );
});
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, templateId }) => {
  await archiveTemplate(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(templateId));
  return noContent();
});
