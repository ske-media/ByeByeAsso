import { manualConsentSchema, recordManualConsent } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; contactId: string };

/** POST — contacts.manage: manual consent record (granted | withdrawn) with mandatory evidence. Append-only. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, contactId }) => {
  const body = await parseBody(ctx.request, manualConsentSchema);
  return created(
    await recordManualConsent(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(contactId), body),
  );
});
