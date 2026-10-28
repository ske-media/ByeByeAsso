import { getPublicOrganization, listPublicEvents } from "@kroov/domain/events";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/v1/public/organizations/{slug} — public: organization card + published public events. */
export const GET = apiRoute<{ slug: string }>({ auth: "optional" }, async (_ctx, { slug }) => {
  const organization = await getPublicOrganization(db(), slug);
  const events = await listPublicEvents(db(), organization.id);
  return ok({ organization, events }, { headers: { "Cache-Control": "public, max-age=60" } });
});
