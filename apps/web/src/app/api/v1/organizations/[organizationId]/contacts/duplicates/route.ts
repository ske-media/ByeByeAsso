import { findDuplicates } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — contacts.read: candidate duplicates (same phone, same name). Never merged automatically. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  return ok({ groups: await findDuplicates(db(), ctx.actor, uuidSchema.parse(organizationId)) });
});
