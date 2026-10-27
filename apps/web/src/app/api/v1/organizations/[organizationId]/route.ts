import { getOrganization, updateOrganization, updateOrganizationSchema } from "@kroov/domain/organizations";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET /api/v1/organizations/{id} — organization.read (404 for non-members). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await getOrganization(db(), ctx.actor, uuidSchema.parse(organizationId))),
);

/** PATCH /api/v1/organizations/{id} — organization.manage. Audited. */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const input = await parseBody(ctx.request, updateOrganizationSchema);
  return ok(await updateOrganization(db(), ctx.actor, uuidSchema.parse(organizationId), input));
});
