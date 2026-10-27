import { listMembers } from "@kroov/domain/organizations";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/v1/organizations/{id}/members — organization.read. */
export const GET = apiRoute<{ organizationId: string }>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await listMembers(db(), ctx.actor, uuidSchema.parse(organizationId))),
);
