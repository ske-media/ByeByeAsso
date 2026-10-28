import { getPublicEvent } from "@kroov/domain/events";
import { getPublicVolunteering } from "@kroov/domain/volunteers";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { slug: string; eventSlug: string };

/** GET — anonymous: positions, shift times, skills and questions when recruitment is open (published event only). */
export const GET = apiRoute<Params>({ auth: "optional" }, async (_ctx, { slug, eventSlug }) => {
  const event = await getPublicEvent(db(), slug, eventSlug);
  return ok(await getPublicVolunteering(db(), event.organization.id, event.id), {
    headers: { "Cache-Control": "no-store" },
  });
});
