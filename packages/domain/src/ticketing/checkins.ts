import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requirePermission } from "../authorization";
import { type Actor, ForbiddenError, NotFoundError } from "../kernel";
import { deriveToken, hashToken, type TicketingContext, TOKEN_SCOPES } from "./context";

export type ScanResult = "accepted" | "already_used" | "revoked" | "refunded" | "invalid";

export interface ScanOutcome {
  result: ScanResult;
  ticket: { number: string; attendeeName: string | null; typeLabel: string } | null;
  /** For `already_used`: when and by whom the ticket was first admitted. */
  firstScan: { at: Date; byName: string | null } | null;
  scannedAt: Date;
  counters: { admitted: number; valid: number };
}

export interface CheckinSummary {
  admitted: number;
  valid: number;
  recent: Array<{
    at: Date;
    result: ScanResult;
    number: string | null;
    attendeeName: string | null;
    byName: string | null;
  }>;
}

async function counters(db: DbExecutor, eventId: string): Promise<{ admitted: number; valid: number }> {
  const [r] = await db
    .select({
      admitted: sql<number>`count(*) filter (where ${schema.tickets.status} = 'used')::int`,
      valid: sql<number>`count(*) filter (where ${schema.tickets.status} in ('valid','used'))::int`,
    })
    .from(schema.tickets)
    .where(eq(schema.tickets.eventId, eventId));
  return { admitted: r?.admitted ?? 0, valid: r?.valid ?? 0 };
}

/**
 * Scan a QR credential for ONE event. The admission is atomic: a conditional UPDATE
 * (`status = 'valid'`) decides who wins when two devices scan the same ticket at once, and the
 * partial unique index on `checkins` is the second lock. Every attempt is recorded.
 */
export async function scanTicket(
  db: Database,
  _ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  eventId: string,
  credential: string,
  device: string | null = null,
  now = new Date(),
): Promise<ScanOutcome> {
  if (actor.kind !== "user") throw new ForbiddenError("user");
  await requirePermission(db, actor, "checkins.scan", { organizationId, eventId });
  const hash = hashToken(credential.trim());
  const rows = await db
    .select({ ticket: schema.tickets, typeLabel: schema.ticketTypes.name })
    .from(schema.tickets)
    .innerJoin(schema.ticketTypes, eq(schema.ticketTypes.id, schema.tickets.ticketTypeId))
    .where(and(eq(schema.tickets.qrCredentialHash, hash), eq(schema.tickets.organizationId, organizationId)))
    .limit(1);
  const found = rows[0];
  // Unknown credential OR a ticket of another event: nothing is disclosed, `invalid` is recorded.
  if (!found || found.ticket.eventId !== eventId) {
    await db.insert(schema.checkins).values({
      organizationId,
      eventId,
      ticketId: null,
      result: "invalid",
      scannedBy: actor.userId,
      device,
      scannedAt: now,
    });
    return { result: "invalid", ticket: null, firstScan: null, scannedAt: now, counters: await counters(db, eventId) };
  }
  const t = found.ticket;
  const ticketView = { number: t.number, attendeeName: t.attendeeName, typeLabel: found.typeLabel };
  let result: ScanResult;
  let firstScan: ScanOutcome["firstScan"] = null;
  if (t.status === "valid") {
    const updated = await db
      .update(schema.tickets)
      .set({ status: "used", usedAt: now })
      .where(and(eq(schema.tickets.id, t.id), eq(schema.tickets.status, "valid")))
      .returning({ id: schema.tickets.id });
    result = updated.length === 1 ? "accepted" : "already_used";
  } else if (t.status === "used") {
    result = "already_used";
  } else if (t.status === "refunded") {
    result = "refunded";
  } else {
    result = "revoked"; // revoked, or pending (unpaid): never admitted
  }
  if (result === "already_used") {
    const first = await db
      .select({ at: schema.checkins.scannedAt, byName: schema.users.name })
      .from(schema.checkins)
      .innerJoin(schema.users, eq(schema.users.id, schema.checkins.scannedBy))
      .where(and(eq(schema.checkins.ticketId, t.id), eq(schema.checkins.result, "accepted")))
      .limit(1);
    firstScan = first[0]
      ? { at: first[0].at, byName: first[0].byName }
      : t.usedAt
        ? { at: t.usedAt, byName: null }
        : null;
  }
  await db
    .insert(schema.checkins)
    .values({ organizationId, eventId, ticketId: t.id, result, scannedBy: actor.userId, device, scannedAt: now });
  return { result, ticket: ticketView, firstScan, scannedAt: now, counters: await counters(db, eventId) };
}

export async function checkinSummary(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<CheckinSummary> {
  await requirePermission(db, actor, "checkins.scan", { organizationId, eventId });
  const recent = await db
    .select({
      at: schema.checkins.scannedAt,
      result: schema.checkins.result,
      number: schema.tickets.number,
      attendeeName: schema.tickets.attendeeName,
      byName: schema.users.name,
    })
    .from(schema.checkins)
    .leftJoin(schema.tickets, eq(schema.tickets.id, schema.checkins.ticketId))
    .innerJoin(schema.users, eq(schema.users.id, schema.checkins.scannedBy))
    .where(and(eq(schema.checkins.eventId, eventId), eq(schema.checkins.organizationId, organizationId)))
    .orderBy(desc(schema.checkins.scannedAt))
    .limit(30);
  return { ...(await counters(db, eventId)), recent };
}

/* ------------------------------------------------------------------------- */
/* ticket page (holder)                                                       */
/* ------------------------------------------------------------------------- */

export interface TicketPageView {
  id: string;
  number: string;
  status: "pending" | "valid" | "used" | "revoked" | "refunded";
  attendeeName: string | null;
  typeLabel: string;
  priceMinor: number;
  currency: string;
  /** Opaque credential to render as QR (derived, never stored). Null unless the ticket is valid/used. */
  qrCredential: string | null;
  usedAt: Date | null;
  order: { id: string; number: string; buyerName: string };
  event: {
    title: string;
    slug: string;
    startsAt: Date;
    endsAt: Date;
    doorsAt: Date | null;
    timezone: string;
    locationName: string | null;
    city: string | null;
  };
  organization: { name: string; slug: string };
  /** Numbers of the sibling tickets in the same order (for « Suivant : … »). */
  siblings: Array<{ id: string; number: string; attendeeName: string | null }>;
}

/** Resolve a ticket by its view token (ticket link). Uniform 404. */
export async function getTicketByViewToken(
  db: DbExecutor,
  ctx: TicketingContext,
  viewToken: string,
): Promise<TicketPageView> {
  const hash = hashToken(viewToken.trim());
  const rows = await db
    .select({
      ticket: schema.tickets,
      typeLabel: schema.ticketTypes.name,
      order: schema.orders,
      event: schema.events,
      org: schema.organizations,
      location: schema.eventLocations,
    })
    .from(schema.tickets)
    .innerJoin(schema.ticketTypes, eq(schema.ticketTypes.id, schema.tickets.ticketTypeId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.tickets.orderId))
    .innerJoin(schema.events, eq(schema.events.id, schema.tickets.eventId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.tickets.organizationId))
    .leftJoin(schema.eventLocations, eq(schema.eventLocations.id, schema.events.locationId))
    .where(eq(schema.tickets.viewTokenHash, hash))
    .limit(1);
  const r = rows[0];
  if (!r) throw new NotFoundError("Billet");
  const siblings = await db
    .select({ id: schema.tickets.id, number: schema.tickets.number, attendeeName: schema.tickets.attendeeName })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.orderId, r.order.id), inArray(schema.tickets.status, ["valid", "used"])))
    .orderBy(schema.tickets.number);
  const t = r.ticket;
  return {
    id: t.id,
    number: t.number,
    status: t.status,
    attendeeName: t.attendeeName,
    typeLabel: r.typeLabel,
    priceMinor: t.priceMinor,
    currency: r.order.currency,
    qrCredential:
      t.status === "valid" || t.status === "used"
        ? deriveToken(ctx.credentialSecret, TOKEN_SCOPES.ticketQr, t.id, t.secretVersion)
        : null,
    usedAt: t.usedAt,
    order: {
      id: r.order.id,
      number: r.order.number,
      buyerName: [r.order.buyerFirstName, r.order.buyerLastName].filter(Boolean).join(" "),
    },
    event: {
      title: r.event.title,
      slug: r.event.slug,
      startsAt: r.event.startsAt,
      endsAt: r.event.endsAt,
      doorsAt: r.event.doorsAt,
      timezone: r.event.timezone,
      locationName: r.location?.name ?? null,
      city: r.location?.city ?? null,
    },
    organization: { name: r.org.name, slug: r.org.slug },
    siblings,
  };
}
