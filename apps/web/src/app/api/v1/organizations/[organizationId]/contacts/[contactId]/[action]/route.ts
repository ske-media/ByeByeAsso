import { setContactArchived } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; contactId: string; action: string };

/** POST — contacts.manage: archive | restore. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, contactId, action }) => {
  if (action !== "archive" && action !== "restore") return apiError(404, "not_found", "Action inconnue.");
  await setContactArchived(
    db(),
    ctx.actor,
    uuidSchema.parse(organizationId),
    uuidSchema.parse(contactId),
    action === "archive",
  );
  return ok({ status: action === "archive" ? "archived" : "active" });
});
