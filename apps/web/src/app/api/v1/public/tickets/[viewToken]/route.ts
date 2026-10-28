import { getTicketByViewToken } from "@kroov/domain/ticketing";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { viewToken: string };

/** GET — holder of the ticket link: ticket page data including the QR credential (valid/used only). */
export const GET = apiRoute<Params>({ auth: "optional" }, async (_ctx, { viewToken }) =>
  ok(await getTicketByViewToken(db(), ticketingContext(), viewToken), { headers: { "Cache-Control": "no-store" } }),
);
