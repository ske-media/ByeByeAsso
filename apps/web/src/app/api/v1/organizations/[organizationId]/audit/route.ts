import { listAuditLog } from "@kroov/domain/organizations";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/v1/organizations/{id}/audit — organization.manage; last 50 entries. */
export const GET = apiRoute<{ organizationId: string }>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await listAuditLog(db(), ctx.actor, uuidSchema.parse(organizationId))),
);
