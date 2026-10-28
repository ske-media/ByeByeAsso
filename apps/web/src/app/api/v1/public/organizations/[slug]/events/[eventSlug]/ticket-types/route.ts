import { getPublicEvent } from "@kroov/domain/events";
import { getPublicTicketing } from "@kroov/domain/ticketing";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

type Params = { slug: string; eventSlug: string };

/** GET — anonymous: visible ticket types with live availability and buyer fees. Not cached. */
export const GET = apiRoute<Params>({ auth: "optional" }, async (_ctx, { slug, eventSlug }) => {
  const event = await getPublicEvent(db(), slug, eventSlug);
  return ok(await getPublicTicketing(db(), event.organization.id, event.id, ticketingContext().fees), {
    headers: { "Cache-Control": "no-store" },
  });
});
