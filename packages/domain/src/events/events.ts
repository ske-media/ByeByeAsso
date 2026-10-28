import { RESERVED_SLUGS } from "@kroov/config/constants";
import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { contextHasPermission, loadMemberContext, requirePermission } from "../authorization";
import {
  type Actor,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  UnauthenticatedError,
} from "../kernel";
import { emitDomainEvent } from "../outbox";
import {
  type CancelEventInput,
  type CreateEventInput,
  cancelEventSchema,
  createEventSchema,
  type ListEventsInput,
  listEventsSchema,
  type UpdateEventInput,
  updateEventSchema,
} from "./schemas";
import { type EventStatus, eventStateMachine } from "./state-machine";

export interface EventLocationView {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string;
  country: string;
  accessNotes: string | null;
}

export interface EventView {
  id: string;
  organizationId: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  doorsAt: Date | null;
  timezone: string;
  capacity: number;
  status: EventStatus;
  visibility: "public" | "unlisted" | "private";
  version: number;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  location: EventLocationView | null;
  settings: {
    accessInfo: string | null;
    programme: string | null;
    contactEmail: string | null;
    externalUrl: string | null;
    showRemainingCapacity: boolean;
  };
}

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function requireUserId(actor: Actor): string {
  if (actor.kind !== "user") throw new UnauthenticatedError();
  return actor.userId;
}

async function loadEventUnchecked(db: DbExecutor, organizationId: string, eventId: string): Promise<EventView> {
  const rows = await db
    .select({
      event: schema.events,
      settings: schema.eventSettings,
      location: schema.eventLocations,
    })
    .from(schema.events)
    .innerJoin(schema.eventSettings, eq(schema.eventSettings.eventId, schema.events.id))
    .leftJoin(schema.eventLocations, eq(schema.eventLocations.id, schema.events.locationId))
    .where(and(eq(schema.events.id, eventId), eq(schema.events.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Événement", eventId);
  return toView(row.event, row.settings, row.location);
}

function toView(
  e: typeof schema.events.$inferSelect,
  s: typeof schema.eventSettings.$inferSelect,
  l: typeof schema.eventLocations.$inferSelect | null,
): EventView {
  return {
    id: e.id,
    organizationId: e.organizationId,
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
    version: e.version,
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

/** Ensure the location belongs to the organization (tenant-safe) and is not archived. */
async function assertLocation(db: DbExecutor, organizationId: string, locationId: string): Promise<void> {
  const rows = await db
    .select({ id: schema.eventLocations.id, archivedAt: schema.eventLocations.archivedAt })
    .from(schema.eventLocations)
    .where(and(eq(schema.eventLocations.id, locationId), eq(schema.eventLocations.organizationId, organizationId)))
    .limit(1);
  const loc = rows[0];
  if (!loc) throw new NotFoundError("Lieu", locationId);
  if (loc.archivedAt) throw new PreconditionFailedError("Ce lieu est archivé.", { field: "locationId" });
}

/* ------------------------------------------------------------------------- */
/* Commands                                                                   */
/* ------------------------------------------------------------------------- */

export async function createEvent(
  db: Database,
  actor: Actor,
  organizationId: string,
  rawInput: CreateEventInput,
): Promise<EventView> {
  const userId = requireUserId(actor);
  await requirePermission(db, actor, "events.create", { organizationId });
  const input = createEventSchema.parse(rawInput);
  const baseSlug = input.slug ?? slugify(input.title);
  if (!baseSlug || RESERVED_SLUGS.has(baseSlug)) {
    throw new ConflictError("Cet identifiant d'adresse n'est pas disponible.", { field: "slug" });
  }

  return db.transaction(async (tx) => {
    if (input.locationId) await assertLocation(tx, organizationId, input.locationId);

    // Unique slug within the organization: append a counter when auto-generated.
    let slug = baseSlug;
    for (let i = 2; i < 50; i += 1) {
      const taken = await tx
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(and(eq(schema.events.organizationId, organizationId), eq(schema.events.slug, slug)))
        .limit(1);
      if (taken.length === 0) break;
      if (input.slug)
        throw new ConflictError("Cet identifiant d'adresse est déjà utilisé pour un autre événement.", {
          field: "slug",
        });
      slug = `${baseSlug.slice(0, 60)}-${i}`;
    }

    const [created] = await tx
      .insert(schema.events)
      .values({
        organizationId,
        slug,
        title: input.title,
        tagline: input.tagline ?? null,
        description: input.description ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        doorsAt: input.doorsAt ?? null,
        timezone: input.timezone,
        capacity: input.capacity,
        visibility: input.visibility,
        locationId: input.locationId ?? null,
        createdBy: userId,
      })
      .returning({ id: schema.events.id });
    if (!created) throw new Error("Insertion de l'événement échouée");

    await tx.insert(schema.eventSettings).values({
      eventId: created.id,
      organizationId,
      accessInfo: input.settings?.accessInfo ?? null,
      programme: input.settings?.programme ?? null,
      contactEmail: input.settings?.contactEmail ?? null,
      externalUrl: input.settings?.externalUrl ?? null,
      showRemainingCapacity: input.settings?.showRemainingCapacity ?? true,
    });

    await recordAudit(tx, actor, {
      organizationId,
      action: "event.created",
      targetType: "event",
      targetId: created.id,
      metadata: { slug, title: input.title },
    });
    return loadEventUnchecked(tx, organizationId, created.id);
  });
}

/** Read one event (events.read at organization or event scope). Non-members → 404. */
export async function getEvent(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<EventView> {
  try {
    await requirePermission(db, actor, "events.read", { organizationId, eventId });
  } catch (error) {
    if (error instanceof UnauthenticatedError) throw error;
    throw new NotFoundError("Événement", eventId);
  }
  return loadEventUnchecked(db, organizationId, eventId);
}

export async function getEventBySlug(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  slug: string,
): Promise<EventView> {
  const rows = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.organizationId, organizationId), eq(schema.events.slug, slug)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Événement", slug);
  return getEvent(db, actor, organizationId, row.id);
}

export interface EventListItem {
  id: string;
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  status: EventStatus;
  visibility: "public" | "unlisted" | "private";
  capacity: number;
  locationName: string | null;
  city: string | null;
}

/**
 * Events the actor may read: all of them with an organization-wide `events.read`,
 * otherwise only the events of their scoped grants. `status: "active"` = draft + published + suspended.
 */
export async function listEvents(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  rawInput: ListEventsInput = {},
): Promise<EventListItem[]> {
  if (actor.kind !== "user") throw new UnauthenticatedError();
  const input = listEventsSchema.parse(rawInput);
  const ctx = await loadMemberContext(db, actor.userId, organizationId);
  if (!ctx) throw new ForbiddenError("events.read");
  const orgWide = contextHasPermission(ctx, "events.read", { organizationId });
  const scopedIds = [...ctx.eventPermissions.entries()]
    .filter(([, perms]) => perms.has("events.read"))
    .map(([id]) => id);
  if (!orgWide && scopedIds.length === 0) throw new ForbiddenError("events.read");

  const statuses: EventStatus[] =
    input.status === "all"
      ? ["draft", "published", "suspended", "completed", "cancelled", "archived"]
      : input.status === "active"
        ? ["draft", "published", "suspended"]
        : [input.status];

  const conditions = [eq(schema.events.organizationId, organizationId), inArray(schema.events.status, statuses)];
  if (!orgWide) conditions.push(inArray(schema.events.id, scopedIds));
  if (input.q)
    conditions.push(or(ilike(schema.events.title, `%${input.q}%`), ilike(schema.events.slug, `%${input.q}%`))!);

  const rows = await db
    .select({
      id: schema.events.id,
      slug: schema.events.slug,
      title: schema.events.title,
      startsAt: schema.events.startsAt,
      endsAt: schema.events.endsAt,
      timezone: schema.events.timezone,
      status: schema.events.status,
      visibility: schema.events.visibility,
      capacity: schema.events.capacity,
      locationName: schema.eventLocations.name,
      city: schema.eventLocations.city,
    })
    .from(schema.events)
    .leftJoin(schema.eventLocations, eq(schema.eventLocations.id, schema.events.locationId))
    .where(and(...conditions))
    .orderBy(asc(schema.events.startsAt), desc(schema.events.createdAt))
    .limit(200);
  return rows;
}

/**
 * Update with optimistic concurrency: the client sends the `version` it read; a stale
 * version is refused (409 `stale_version`) and nothing is written.
 */
export async function updateEvent(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  rawInput: UpdateEventInput,
): Promise<EventView> {
  await requirePermission(db, actor, "events.update", { organizationId, eventId });
  const input = updateEventSchema.parse(rawInput);

  return db.transaction(async (tx) => {
    const current = await loadEventUnchecked(tx, organizationId, eventId);
    if (current.status === "archived")
      throw new PreconditionFailedError("Un événement archivé ne peut plus être modifié.");
    if (current.version !== input.version) {
      throw new ConflictError(
        "Cet événement a été modifié entre-temps. Rechargez la page pour voir la dernière version.",
        {
          code: "stale_version",
          currentVersion: current.version,
        },
      );
    }
    const startsAt = input.startsAt ?? current.startsAt;
    const endsAt = input.endsAt ?? current.endsAt;
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new PreconditionFailedError("La fin doit être postérieure au début.", { field: "endsAt" });
    }
    const doorsAt = input.doorsAt === undefined ? current.doorsAt : input.doorsAt;
    if (doorsAt && doorsAt.getTime() > startsAt.getTime()) {
      throw new PreconditionFailedError("L'ouverture des portes doit précéder le début.", { field: "doorsAt" });
    }
    if (input.locationId) await assertLocation(tx, organizationId, input.locationId);

    const patch: Partial<typeof schema.events.$inferInsert> = { version: current.version + 1 };
    if (input.title !== undefined) patch.title = input.title;
    if ("tagline" in input) patch.tagline = input.tagline ?? null;
    if ("description" in input) patch.description = input.description ?? null;
    if (input.startsAt !== undefined) patch.startsAt = input.startsAt;
    if (input.endsAt !== undefined) patch.endsAt = input.endsAt;
    if (input.doorsAt !== undefined) patch.doorsAt = input.doorsAt;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.capacity !== undefined) patch.capacity = input.capacity;
    if (input.visibility !== undefined) patch.visibility = input.visibility;
    if (input.locationId !== undefined) patch.locationId = input.locationId;

    const updated = await tx
      .update(schema.events)
      .set(patch)
      .where(
        and(
          eq(schema.events.id, eventId),
          eq(schema.events.organizationId, organizationId),
          eq(schema.events.version, input.version),
        ),
      )
      .returning({ id: schema.events.id });
    if (updated.length === 0) {
      throw new ConflictError(
        "Cet événement a été modifié entre-temps. Rechargez la page pour voir la dernière version.",
        {
          code: "stale_version",
        },
      );
    }

    if (input.settings) {
      const s: Partial<typeof schema.eventSettings.$inferInsert> = {};
      if ("accessInfo" in input.settings) s.accessInfo = input.settings.accessInfo ?? null;
      if ("programme" in input.settings) s.programme = input.settings.programme ?? null;
      if ("contactEmail" in input.settings) s.contactEmail = input.settings.contactEmail ?? null;
      if ("externalUrl" in input.settings) s.externalUrl = input.settings.externalUrl ?? null;
      if (input.settings.showRemainingCapacity !== undefined)
        s.showRemainingCapacity = input.settings.showRemainingCapacity;
      if (Object.keys(s).length > 0) {
        await tx.update(schema.eventSettings).set(s).where(eq(schema.eventSettings.eventId, eventId));
      }
    }

    const datesChanged = input.startsAt !== undefined || input.endsAt !== undefined;
    await recordAudit(tx, actor, {
      organizationId,
      action: "event.updated",
      targetType: "event",
      targetId: eventId,
      metadata: { fields: Object.keys(input).filter((k) => k !== "version"), fromVersion: input.version },
    });
    if (current.status === "published" && (datesChanged || input.locationId !== undefined)) {
      // Phase 3 will notify ticket holders; the event is emitted now so nothing is lost.
      await emitDomainEvent(tx, {
        aggregateType: "event",
        aggregateId: eventId,
        eventType: "event.logistics_changed",
        organizationId,
        payload: { datesChanged, locationChanged: input.locationId !== undefined },
      });
    }
    return loadEventUnchecked(tx, organizationId, eventId);
  });
}

/* ------------------------------------------------------------------------- */
/* Publication                                                                */
/* ------------------------------------------------------------------------- */

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
}

/** The publication checklist shown on screen 07 and enforced by `publishEvent`. */
export function publicationChecklist(event: EventView): ChecklistItem[] {
  const now = Date.now();
  return [
    { key: "title", label: "Titre renseigné", ok: event.title.trim().length >= 2 },
    {
      key: "description",
      label: "Description de l'événement",
      ok: Boolean(event.description && event.description.trim().length >= 20),
      hint: "Au moins 20 caractères : dites aux participants ce qui les attend.",
    },
    { key: "dates", label: "Dates cohérentes", ok: event.endsAt.getTime() > event.startsAt.getTime() },
    { key: "future", label: "L'événement n'est pas déjà terminé", ok: event.endsAt.getTime() > now },
    { key: "location", label: "Lieu défini", ok: event.location !== null, hint: "Ajoutez ou choisissez un lieu." },
    {
      key: "capacity",
      label: "Capacité supérieure à zéro",
      ok: event.capacity > 0,
      hint: "La capacité borne la billetterie.",
    },
  ];
}

export async function publishEvent(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  version: number,
): Promise<EventView> {
  await requirePermission(db, actor, "events.publish", { organizationId, eventId });
  return db.transaction(async (tx) => {
    const orgRows = await tx
      .select({ status: schema.organizations.status })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .for("update")
      .limit(1);
    const event = await loadEventUnchecked(tx, organizationId, eventId);
    if (event.version !== version) {
      throw new ConflictError(
        "Cet événement a été modifié entre-temps. Vérifiez la dernière version avant de publier.",
        {
          code: "stale_version",
          currentVersion: event.version,
        },
      );
    }
    const checklist = publicationChecklist(event);
    const failed = checklist.filter((c) => !c.ok);
    const guardCtx = {
      actor: actor.kind === "user" ? actor.userId : actor.kind,
      checklistPassed: failed.length === 0,
      organizationActive: orgRows[0]?.status === "active",
    };
    const reasons = eventStateMachine.denialReasons(event.status, "published", guardCtx);
    if (reasons.length > 0) {
      throw new PreconditionFailedError(reasons[0] ?? "Publication impossible.", {
        code: "publication_blocked",
        checklist: failed.map((c) => c.key),
      });
    }
    const transition = eventStateMachine.transition(event.status, "published", guardCtx);
    await tx
      .update(schema.events)
      .set({ status: "published", publishedAt: event.publishedAt ?? transition.at, version: event.version + 1 })
      .where(eq(schema.events.id, eventId));
    await recordAudit(tx, actor, {
      organizationId,
      action: "event.published",
      targetType: "event",
      targetId: eventId,
      metadata: { from: transition.from, visibility: event.visibility },
    });
    await emitDomainEvent(tx, {
      aggregateType: "event",
      aggregateId: eventId,
      eventType: "event.published",
      organizationId,
      payload: { slug: event.slug, startsAt: event.startsAt.toISOString() },
    });
    return loadEventUnchecked(tx, organizationId, eventId);
  });
}

export async function cancelEvent(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  rawInput: CancelEventInput,
): Promise<EventView> {
  await requirePermission(db, actor, "events.cancel", { organizationId, eventId });
  const input = cancelEventSchema.parse(rawInput);
  return db.transaction(async (tx) => {
    const event = await loadEventUnchecked(tx, organizationId, eventId);
    if (event.version !== input.version) {
      throw new ConflictError("Cet événement a été modifié entre-temps.", {
        code: "stale_version",
        currentVersion: event.version,
      });
    }
    const guardCtx = {
      actor: actor.kind === "user" ? actor.userId : actor.kind,
      reason: input.reason,
      checklistPassed: true,
      organizationActive: true,
    };
    const transition = eventStateMachine.transition(event.status, "cancelled", guardCtx);
    await tx
      .update(schema.events)
      .set({
        status: "cancelled",
        cancelledAt: transition.at,
        cancellationReason: input.reason,
        version: event.version + 1,
      })
      .where(eq(schema.events.id, eventId));
    await recordAudit(tx, actor, {
      organizationId,
      action: "event.cancelled",
      targetType: "event",
      targetId: eventId,
      reason: input.reason,
      metadata: { from: transition.from },
    });
    await emitDomainEvent(tx, {
      aggregateType: "event",
      aggregateId: eventId,
      eventType: "event.cancelled",
      organizationId,
      payload: { reason: input.reason },
    });
    return loadEventUnchecked(tx, organizationId, eventId);
  });
}

export async function archiveEvent(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  version: number,
): Promise<EventView> {
  await requirePermission(db, actor, "events.update", { organizationId, eventId });
  return db.transaction(async (tx) => {
    const event = await loadEventUnchecked(tx, organizationId, eventId);
    if (event.version !== version) {
      throw new ConflictError("Cet événement a été modifié entre-temps.", {
        code: "stale_version",
        currentVersion: event.version,
      });
    }
    const guardCtx = {
      actor: actor.kind === "user" ? actor.userId : actor.kind,
      checklistPassed: true,
      organizationActive: true,
    };
    const transition = eventStateMachine.transition(event.status, "archived", guardCtx);
    await tx
      .update(schema.events)
      .set({ status: "archived", archivedAt: transition.at, version: event.version + 1 })
      .where(eq(schema.events.id, eventId));
    await recordAudit(tx, actor, {
      organizationId,
      action: "event.archived",
      targetType: "event",
      targetId: eventId,
      metadata: { from: transition.from },
    });
    return loadEventUnchecked(tx, organizationId, eventId);
  });
}

/** Hard-delete a DRAFT (never a published event). */
export async function deleteDraftEvent(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<void> {
  await requirePermission(db, actor, "events.update", { organizationId, eventId });
  await db.transaction(async (tx) => {
    const event = await loadEventUnchecked(tx, organizationId, eventId);
    if (event.status !== "draft") {
      throw new PreconditionFailedError(
        "Seul un brouillon peut être supprimé. Un événement publié s'annule puis s'archive.",
        {
          status: event.status,
        },
      );
    }
    await tx
      .delete(schema.events)
      .where(and(eq(schema.events.id, eventId), eq(schema.events.organizationId, organizationId)));
    await recordAudit(tx, actor, {
      organizationId,
      action: "event.draft_deleted",
      targetType: "event",
      targetId: eventId,
      metadata: { slug: event.slug },
    });
  });
}

/**
 * System job: mark published events whose end is more than 24 h in the past as completed.
 * Returns the number of events transitioned.
 */
export async function completeEndedEvents(db: Database, actor: Actor): Promise<number> {
  if (actor.kind !== "system") throw new ForbiddenError("system");
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: schema.events.id, organizationId: schema.events.organizationId })
      .from(schema.events)
      .where(and(eq(schema.events.status, "published"), sql`${schema.events.endsAt} < ${cutoff}`))
      .limit(500);
    for (const row of rows) {
      await tx
        .update(schema.events)
        .set({ status: "completed", completedAt: new Date(), version: sql`${schema.events.version} + 1` })
        .where(eq(schema.events.id, row.id));
      await recordAudit(tx, actor, {
        organizationId: row.organizationId,
        action: "event.completed",
        targetType: "event",
        targetId: row.id,
      });
      await emitDomainEvent(tx, {
        aggregateType: "event",
        aggregateId: row.id,
        eventType: "event.completed",
        organizationId: row.organizationId,
        payload: {},
      });
    }
    return rows.length;
  });
}
