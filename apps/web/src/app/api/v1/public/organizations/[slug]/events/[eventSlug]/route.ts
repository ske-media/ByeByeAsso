import { getPublicEvent } from "@kroov/domain/events";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/v1/public/organizations/{slug}/events/{eventSlug} — public: published public/unlisted event; 404 otherwise. */
export const GET = apiRoute<{ slug: string; eventSlug: string }>(
  { auth: "optional" },
  async (_ctx, { slug, eventSlug }) =>
    ok(await getPublicEvent(db(), slug, eventSlug), { headers: { "Cache-Control": "public, max-age=60" } }),
);
