import { getMembership } from "@kroov/domain/memberships";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { organizationId: string; membershipId: string };

/** GET — memberships.manage: membership with application, payment and validity history. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, membershipId }) =>
  ok(
    await getMembership(
      db(),
      ticketingContext(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(membershipId),
    ),
  ),
);
