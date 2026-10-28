import type { DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { NotFoundError } from "../kernel";
import type { EventView } from "./events";

/**
 * Public read models (no actor). Only PUBLISHED events are ever returned:
 * - organization page lists `public` events only (upcoming first, then recent past 30 days);
 * - event page serves `public` and `unlisted` (direct link); `private` and non-published → 404.
 * Draft, suspended, cancelled, completed and archived events are never served as live
 * (cancelled/completed are shown on the event page with their status so links keep working).
 */

export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
  legalForm: string;
  timezone: string;
  contactEmail: string | null;
  website: string | null;
}

export interface PublicEventCard {
  slug: string;
  title: string;
  tagline: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  locationName: string | null;
  city: string | null;
}

export async function getPublicOrganization(db: DbExecutor, slug: string): Promise<PublicOrganization> {
  const rows = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      legalForm: schema.organizations.legalForm,
      timezone: schema.organizations.timezone,
      status: schema.organizations.status,
      contactEmail: schema.organizationSettings.contactEmail,
      website: schema.organizationSettings.website,
    })
    .from(schema.organizations)
    .innerJoin(schema.organizationSettings, eq(schema.organizationSettings.organizationId, schema.organizations.id))
    .where(eq(schema.organizations.slug, slug))
    .limit(1);
  const row = rows[0];
  if (row?.status !== "active") throw new NotFoundError("Organisation", slug);
  const { status: _status, ...org } = row;
  return org;
}

export async function listPublicEvents(db: DbExecutor, organizationId: string): Promise<PublicEventCard[]> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  return db
    .select({
      slug: schema.events.slug,
      title: schema.events.title,
      tagline: schema.events.tagline,
      startsAt: schema.events.startsAt,
      endsAt: schema.events.endsAt,
      timezone: schema.events.timezone,
      locationName: schema.eventLocations.name,
      city: schema.eventLocations.city,
    })
    .from(schema.events)
    .leftJoin(schema.eventLocations, eq(schema.eventLocations.id, schema.events.locationId))
    .where(
      and(
        eq(schema.events.organizationId, organizationId),
        eq(schema.events.status, "published"),
        eq(schema.events.visibility, "public"),
        gt(schema.events.endsAt, since),
      ),
    )
    .orderBy(asc(schema.events.startsAt))
    .limit(100);
}

export type PublicEvent = Omit<EventView, "version" | "organizationId"> & { organization: PublicOrganization };

export async function getPublicEvent(
  db: DbExecutor,
  organizationSlug: string,
  eventSlug: string,
): Promise<PublicEvent> {
  const organization = await getPublicOrganization(db, organizationSlug);
  const rows = await db
    .select({ event: schema.events, settings: schema.eventSettings, location: schema.eventLocations })
    .from(schema.events)
    .innerJoin(schema.eventSettings, eq(schema.eventSettings.eventId, schema.events.id))
    .leftJoin(schema.eventLocations, eq(schema.eventLocations.id, schema.events.locationId))
    .where(
      and(
        eq(schema.events.organizationId, organization.id),
        eq(schema.events.slug, eventSlug),
        inArray(schema.events.status, ["published", "cancelled", "completed"]),
        inArray(schema.events.visibility, ["public", "unlisted"]),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Événement", eventSlug);
  const e = row.event;
  const s = row.settings;
  const l = row.location;
  return {
    organization,
    id: e.id,
    slug: e.slug,
    title: e.title,
    tagline: e.tagline,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    doorsAt: e.doorsAt,
    timezone: e.timezone,
    capacity: e.capacity,
    status: e.status,
    visibility: e.visibility,
    publishedAt: e.publishedAt,
    cancelledAt: e.cancelledAt,
    cancellationReason: e.cancellationReason,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    location: l
      ? {
          id: l.id,
          name: l.name,
          addressLine1: l.addressLine1,
          addressLine2: l.addressLine2,
          postalCode: l.postalCode,
          city: l.city,
          country: l.country,
          accessNotes: l.accessNotes,
        }
      : null,
    settings: {
      accessInfo: s.accessInfo,
      programme: s.programme,
      contactEmail: s.contactEmail,
      externalUrl: s.externalUrl,
      showRemainingCapacity: s.showRemainingCapacity,
    },
  };
}
