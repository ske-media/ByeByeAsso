import { startPaymentOnboarding } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string };

/** POST — organization.manage: create the connected account if needed and return the onboarding URL. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const orgId = uuidSchema.parse(organizationId);
  const base = `${env().APP_URL}/api/v1/organizations/${orgId}/payment-account`;
  return ok(
    await startPaymentOnboarding(db(), ticketingContext(), ctx.actor, orgId, {
      returnUrl: `${base}?return=1`,
      refreshUrl: `${base}?refresh=1`,
    }),
  );
});
