import { getPaymentAccount, syncPaymentAccount } from "@kroov/domain/ticketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string };

/** GET — organization.manage: the connected payment account (null when none). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await getPaymentAccount(db(), ticketingContext(), ctx.actor, uuidSchema.parse(organizationId))),
);

/** POST — organization.manage: refresh the status from the provider. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) =>
  ok(await syncPaymentAccount(db(), ticketingContext(), ctx.actor, uuidSchema.parse(organizationId))),
);
