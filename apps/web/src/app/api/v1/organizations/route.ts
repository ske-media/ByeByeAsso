import { createOrganization, createOrganizationSchema, listMyOrganizations } from "@kroov/domain/organizations";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/v1/organizations — organizations of the signed-in user. */
export const GET = apiRoute({ auth: "required" }, async (ctx) => ok(await listMyOrganizations(db(), ctx.actor)));

/**
 * POST /api/v1/organizations — create; the caller becomes owner.
 * 201 + Location. 409 on slug conflict. 422 on validation.
 */
export const POST = apiRoute({ auth: "required" }, async (ctx) => {
  const input = await parseBody(ctx.request, createOrganizationSchema);
  const org = await createOrganization(db(), ctx.actor, input);
  return created(org, `/organizations/${org.id}`);
});
