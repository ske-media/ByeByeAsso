import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { type Actor, ConflictError, NotFoundError, PreconditionFailedError } from "../kernel";
import type { FeePolicy } from "./pricing";
import { unitFee } from "./pricing";
import {
  type PoolInput,
  type PromoCodeInput,
  poolSchema,
  promoCodeSchema,
  type TicketingSettingsInput,
  type TicketTypeInput,
  ticketingSettingsSchema,
  ticketTypeSchema,
  type UpdateTicketTypeInput,
  updateTicketTypeSchema,
} from "./schemas";

/* ------------------------------------------------------------------------- */
/* views                                                                      */
/* ------------------------------------------------------------------------- */

export interface TicketTypeView {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  quota: number | null;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
  minPerOrder: number;
  maxPerOrder: number;
  hidden: boolean;
  position: number;
  status: "active" | "archived";
  poolId: string | null;
  poolName: string | null;
  /** Tickets issued and not refunded/revoked. */
  sold: number;
  /** Seats currently reserved by unpaid orders. */
  held: number;
  /** Seats still purchasable now (null = unbounded). */
  available: number | null;
}

export interface PoolView {
  id: string;
  name: string;
  capacity: number;
  ticketTypeIds: string[];
  sold: number;
  held: number;
}

export interface TicketingSettingsView {
  ticketingStatus: "not_configured" | "open" | "closed";
  maxTicketsPerOrder: number;
  salesCloseAt: Date | null;
  nominativeTickets: boolean;
  capacity: number;
  currency: string;
}

async function assertEvent(db: DbExecutor, organizationId: string, eventId: string) {
  const rows = await db
    .select({
      id: schema.events.id,
      status: schema.events.status,
      capacity: schema.events.capacity,
      ticketingStatus: schema.events.ticketingStatus,
      maxTicketsPerOrder: schema.events.maxTicketsPerOrder,
      salesCloseAt: schema.events.salesCloseAt,
      nominativeTickets: schema.events.nominativeTickets,
      startsAt: schema.events.startsAt,
      currency: schema.organizationSettings.currency,
    })
    .from(schema.events)
    .innerJoin(
      schema.organizationSettings,
      eq(schema.organizationSettings.organizationId, schema.events.organizationId),
    )
    .where(and(eq(schema.events.id, eventId), eq(schema.events.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Événement", eventId);
  return row;
}

/* ------------------------------------------------------------------------- */
/* counters (sold / held) — shared by availability and the organizer views    */
/* ------------------------------------------------------------------------- */

export interface Counters {
  soldByType: Map<string, number>;
  heldByType: Map<string, number>;
}

/** Counts committed seats per ticket type: issued tickets (valid/used) + active, unexpired holds. */
export async function loadCounters(db: DbExecutor, eventId: string, now = new Date()): Promise<Counters> {
  const sold = await db
    .select({ ticketTypeId: schema.tickets.ticketTypeId, n: sql<number>`count(*)::int` })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.eventId, eventId), inArray(schema.tickets.status, ["valid", "used"])))
    .groupBy(schema.tickets.ticketTypeId);
  const held = await db
    .select({
      ticketTypeId: schema.inventoryHoldItems.ticketTypeId,
      n: sql<number>`sum(${schema.inventoryHoldItems.quantity})::int`,
    })
    .from(schema.inventoryHoldItems)
    .innerJoin(schema.inventoryHolds, eq(schema.inventoryHolds.id, schema.inventoryHoldItems.holdId))
    .where(
      and(
        eq(schema.inventoryHolds.eventId, eventId),
        eq(schema.inventoryHolds.status, "active"),
        sql`${schema.inventoryHolds.expiresAt} > ${now}`,
      ),
    )
    .groupBy(schema.inventoryHoldItems.ticketTypeId);
  return {
    soldByType: new Map(sold.map((r) => [r.ticketTypeId, r.n])),
    heldByType: new Map(held.map((r) => [r.ticketTypeId, r.n])),
  };
}

interface TypeRow {
  type: typeof schema.ticketTypes.$inferSelect;
  poolId: string | null;
  poolName: string | null;
  poolCapacity: number | null;
}

async function loadTypeRows(db: DbExecutor, eventId: string): Promise<TypeRow[]> {
  const rows = await db
    .select({
      type: schema.ticketTypes,
      poolId: schema.ticketPoolLinks.poolId,
      poolName: schema.ticketInventoryPools.name,
      poolCapacity: schema.ticketInventoryPools.capacity,
    })
    .from(schema.ticketTypes)
    .leftJoin(schema.ticketPoolLinks, eq(schema.ticketPoolLinks.ticketTypeId, schema.ticketTypes.id))
    .leftJoin(schema.ticketInventoryPools, eq(schema.ticketInventoryPools.id, schema.ticketPoolLinks.poolId))
    .where(eq(schema.ticketTypes.eventId, eventId))
    .orderBy(asc(schema.ticketTypes.position), asc(schema.ticketTypes.createdAt));
  return rows;
}

/**
 * Availability of every type of an event, computed from the same counters the reservation
 * uses under lock: min(type quota, pool capacity, event capacity) − committed seats.
 */
export function computeAvailability(
  rows: TypeRow[],
  counters: Counters,
  eventCapacity: number,
): Map<string, { sold: number; held: number; available: number | null }> {
  const committed = (id: string) => (counters.soldByType.get(id) ?? 0) + (counters.heldByType.get(id) ?? 0);
  const eventCommitted = rows.reduce((acc, r) => acc + committed(r.type.id), 0);
  const poolCommitted = new Map<string, number>();
  for (const r of rows) {
    if (r.poolId) poolCommitted.set(r.poolId, (poolCommitted.get(r.poolId) ?? 0) + committed(r.type.id));
  }
  const out = new Map<string, { sold: number; held: number; available: number | null }>();
  for (const r of rows) {
    const sold = counters.soldByType.get(r.type.id) ?? 0;
    const held = counters.heldByType.get(r.type.id) ?? 0;
    const limits: number[] = [];
    if (r.type.quota !== null) limits.push(r.type.quota - sold - held);
    if (r.poolId && r.poolCapacity !== null) limits.push(r.poolCapacity - (poolCommitted.get(r.poolId) ?? 0));
    if (eventCapacity > 0) limits.push(eventCapacity - eventCommitted);
    const available = limits.length === 0 ? null : Math.max(0, Math.min(...limits));
    out.set(r.type.id, { sold, held, available });
  }
  return out;
}

function toTypeView(r: TypeRow, a: { sold: number; held: number; available: number | null }): TicketTypeView {
  return {
    id: r.type.id,
    eventId: r.type.eventId,
    name: r.type.name,
    description: r.type.description,
    priceMinor: r.type.priceMinor,
    currency: r.type.currency,
    quota: r.type.quota,
    salesStartAt: r.type.salesStartAt,
    salesEndAt: r.type.salesEndAt,
    minPerOrder: r.type.minPerOrder,
    maxPerOrder: r.type.maxPerOrder,
    hidden: r.type.hidden,
    position: r.type.position,
    status: r.type.status,
    poolId: r.poolId,
    poolName: r.poolName,
    sold: a.sold,
    held: a.held,
    available: a.available,
  };
}

/* ------------------------------------------------------------------------- */
/* organizer reads                                                            */
/* ------------------------------------------------------------------------- */

export async function listTicketTypes(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<TicketTypeView[]> {
  await requirePermission(db, actor, "events.read", { organizationId, eventId });
  const event = await assertEvent(db, organizationId, eventId);
  const rows = await loadTypeRows(db, eventId);
  const availability = computeAvailability(rows, await loadCounters(db, eventId), event.capacity);
  return rows.map((r) => toTypeView(r, availability.get(r.type.id) ?? { sold: 0, held: 0, available: null }));
}

export async function listPools(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<PoolView[]> {
  await requirePermission(db, actor, "events.read", { organizationId, eventId });
  const pools = await db
    .select()
    .from(schema.ticketInventoryPools)
    .where(
      and(
        eq(schema.ticketInventoryPools.eventId, eventId),
        eq(schema.ticketInventoryPools.organizationId, organizationId),
      ),
    )
    .orderBy(asc(schema.ticketInventoryPools.createdAt));
  if (pools.length === 0) return [];
  const links = await db
    .select()
    .from(schema.ticketPoolLinks)
    .where(
      inArray(
        schema.ticketPoolLinks.poolId,
        pools.map((p) => p.id),
      ),
    );
  const counters = await loadCounters(db, eventId);
  return pools.map((p) => {
    const ids = links.filter((l) => l.poolId === p.id).map((l) => l.ticketTypeId);
    return {
      id: p.id,
      name: p.name,
      capacity: p.capacity,
      ticketTypeIds: ids,
      sold: ids.reduce((a, id) => a + (counters.soldByType.get(id) ?? 0), 0),
      held: ids.reduce((a, id) => a + (counters.heldByType.get(id) ?? 0), 0),
    };
  });
}

export async function getTicketingSettings(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<TicketingSettingsView> {
  await requirePermission(db, actor, "events.read", { organizationId, eventId });
  const e = await assertEvent(db, organizationId, eventId);
  return {
    ticketingStatus: e.ticketingStatus,
    maxTicketsPerOrder: e.maxTicketsPerOrder,
    salesCloseAt: e.salesCloseAt,
    nominativeTickets: e.nominativeTickets,
    capacity: e.capacity,
    currency: e.currency,
  };
}

/* ------------------------------------------------------------------------- */
/* organizer commands                                                         */
/* ------------------------------------------------------------------------- */

async function linkPool(
  tx: DbExecutor,
  organizationId: string,
  ticketTypeId: string,
  poolId: string | null | undefined,
) {
  if (poolId === undefined) return;
  await tx.delete(schema.ticketPoolLinks).where(eq(schema.ticketPoolLinks.ticketTypeId, ticketTypeId));
  if (poolId === null) return;
  const pool = await tx
    .select({ id: schema.ticketInventoryPools.id })
    .from(schema.ticketInventoryPools)
    .where(
      and(eq(schema.ticketInventoryPools.id, poolId), eq(schema.ticketInventoryPools.organizationId, organizationId)),
    )
    .limit(1);
  if (!pool[0]) throw new NotFoundError("Pool de capacité", poolId);
  await tx.insert(schema.ticketPoolLinks).values({ organizationId, poolId, ticketTypeId });
}

export async function createTicketType(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  input: TicketTypeInput,
): Promise<TicketTypeView> {
  await requirePermission(db, actor, "tickets.manage", { organizationId, eventId });
  const v = ticketTypeSchema.parse(input);
  const event = await assertEvent(db, organizationId, eventId);
  if (event.status === "archived") throw new PreconditionFailedError("Événement archivé.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.ticketTypes)
      .values({
        organizationId,
        eventId,
        name: v.name,
        description: v.description ?? null,
        priceMinor: v.priceMinor,
        currency: event.currency,
        quota: v.quota ?? null,
        salesStartAt: v.salesStartAt ?? null,
        salesEndAt: v.salesEndAt ?? null,
        minPerOrder: v.minPerOrder,
        maxPerOrder: v.maxPerOrder,
        hidden: v.hidden,
        position: v.position,
      })
      .returning({ id: schema.ticketTypes.id });
    if (!row) throw new Error("insert failed");
    await linkPool(tx, organizationId, row.id, v.poolId ?? null);
    await recordAudit(tx, actor, {
      organizationId,
      action: "ticket_type.created",
      targetType: "ticket_type",
      targetId: row.id,
      metadata: { eventId, name: v.name, priceMinor: v.priceMinor, quota: v.quota ?? null },
    });
    const rows = (await loadTypeRows(tx, eventId)).filter((r) => r.type.id === row.id);
    const availability = computeAvailability(rows, await loadCounters(tx, eventId), event.capacity);
    const r = rows[0];
    if (!r) throw new Error("reload failed");
    return toTypeView(r, availability.get(r.type.id) ?? { sold: 0, held: 0, available: null });
  });
}

export async function updateTicketType(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  ticketTypeId: string,
  input: UpdateTicketTypeInput,
): Promise<TicketTypeView> {
  await requirePermission(db, actor, "tickets.manage", { organizationId, eventId });
  const v = updateTicketTypeSchema.parse(input);
  const event = await assertEvent(db, organizationId, eventId);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.ticketTypes)
      .where(and(eq(schema.ticketTypes.id, ticketTypeId), eq(schema.ticketTypes.eventId, eventId)))
      .limit(1);
    const current = existing[0];
    if (!current) throw new NotFoundError("Tarif", ticketTypeId);
    if (current.status === "archived") throw new PreconditionFailedError("Tarif archivé.");
    const patch: Partial<typeof schema.ticketTypes.$inferInsert> = {};
    if (v.name !== undefined) patch.name = v.name;
    if (v.description !== undefined) patch.description = v.description ?? null;
    if (v.priceMinor !== undefined) patch.priceMinor = v.priceMinor;
    if (v.quota !== undefined) patch.quota = v.quota ?? null;
    if (v.salesStartAt !== undefined) patch.salesStartAt = v.salesStartAt ?? null;
    if (v.salesEndAt !== undefined) patch.salesEndAt = v.salesEndAt ?? null;
    if (v.minPerOrder !== undefined) patch.minPerOrder = v.minPerOrder;
    if (v.maxPerOrder !== undefined) patch.maxPerOrder = v.maxPerOrder;
    if (v.hidden !== undefined) patch.hidden = v.hidden;
    if (v.position !== undefined) patch.position = v.position;
    const min = patch.minPerOrder ?? current.minPerOrder;
    const max = patch.maxPerOrder ?? current.maxPerOrder;
    if (max < min)
      throw new PreconditionFailedError("Le maximum par commande doit être ≥ au minimum.", { field: "maxPerOrder" });
    const start = patch.salesStartAt === undefined ? current.salesStartAt : patch.salesStartAt;
    const end = patch.salesEndAt === undefined ? current.salesEndAt : patch.salesEndAt;
    if (start && end && end.getTime() <= start.getTime()) {
      throw new PreconditionFailedError("La fin des ventes doit suivre le début.", { field: "salesEndAt" });
    }
    // A paid ticket keeps its price: changing the price only affects future orders (snapshot in order_items).
    if (Object.keys(patch).length > 0) {
      await tx.update(schema.ticketTypes).set(patch).where(eq(schema.ticketTypes.id, ticketTypeId));
    }
    await linkPool(tx, organizationId, ticketTypeId, v.poolId);
    await recordAudit(tx, actor, {
      organizationId,
      action: "ticket_type.updated",
      targetType: "ticket_type",
      targetId: ticketTypeId,
      metadata: { eventId, fields: Object.keys(patch) },
    });
    const rows = (await loadTypeRows(tx, eventId)).filter((r) => r.type.id === ticketTypeId);
    const availability = computeAvailability(rows, await loadCounters(tx, eventId), event.capacity);
    const r = rows[0];
    if (!r) throw new Error("reload failed");
    return toTypeView(r, availability.get(r.type.id) ?? { sold: 0, held: 0, available: null });
  });
}

/** Archive a ticket type (hidden from sale). Refused while unpaid reservations reference it. */
export async function archiveTicketType(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  ticketTypeId: string,
): Promise<void> {
  await requirePermission(db, actor, "tickets.manage", { organizationId, eventId });
  await db.transaction(async (tx) => {
    const counters = await loadCounters(tx, eventId);
    if ((counters.heldByType.get(ticketTypeId) ?? 0) > 0) {
      throw new PreconditionFailedError(
        "Des réservations en cours utilisent ce tarif. Réessayez dans quelques minutes.",
      );
    }
    const updated = await tx
      .update(schema.ticketTypes)
      .set({ status: "archived", hidden: true })
      .where(
        and(
          eq(schema.ticketTypes.id, ticketTypeId),
          eq(schema.ticketTypes.eventId, eventId),
          eq(schema.ticketTypes.organizationId, organizationId),
        ),
      )
      .returning({ id: schema.ticketTypes.id });
    if (updated.length === 0) throw new NotFoundError("Tarif", ticketTypeId);
    await recordAudit(tx, actor, {
      organizationId,
      action: "ticket_type.archived",
      targetType: "ticket_type",
      targetId: ticketTypeId,
      metadata: { eventId },
    });
  });
}

export async function createPool(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  input: PoolInput,
): Promise<PoolView> {
  await requirePermission(db, actor, "tickets.manage", { organizationId, eventId });
  const v = poolSchema.parse(input);
  await assertEvent(db, organizationId, eventId);
  const [row] = await db
    .insert(schema.ticketInventoryPools)
    .values({ organizationId, eventId, name: v.name, capacity: v.capacity })
    .returning();
  if (!row) throw new Error("insert failed");
  await recordAudit(db, actor, {
    organizationId,
    action: "ticket_pool.created",
    targetType: "ticket_pool",
    targetId: row.id,
    metadata: { eventId, name: v.name, capacity: v.capacity },
  });
  return { id: row.id, name: row.name, capacity: row.capacity, ticketTypeIds: [], sold: 0, held: 0 };
}

export async function deletePool(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  poolId: string,
): Promise<void> {
  await requirePermission(db, actor, "tickets.manage", { organizationId, eventId });
  const deleted = await db
    .delete(schema.ticketInventoryPools)
    .where(
      and(
        eq(schema.ticketInventoryPools.id, poolId),
        eq(schema.ticketInventoryPools.eventId, eventId),
        eq(schema.ticketInventoryPools.organizationId, organizationId),
      ),
    )
    .returning({ id: schema.ticketInventoryPools.id });
  if (deleted.length === 0) throw new NotFoundError("Pool de capacité", poolId);
  await recordAudit(db, actor, {
    organizationId,
    action: "ticket_pool.deleted",
    targetType: "ticket_pool",
    targetId: poolId,
  });
}

/** Sales settings + opening/closing. Opening requires at least one active ticket type and a published event. */
export async function updateTicketingSettings(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  input: TicketingSettingsInput,
): Promise<TicketingSettingsView> {
  await requirePermission(db, actor, "tickets.manage", { organizationId, eventId });
  const v = ticketingSettingsSchema.parse(input);
  return db.transaction(async (tx) => {
    const event = await assertEvent(tx, organizationId, eventId);
    const patch: Partial<typeof schema.events.$inferInsert> = {};
    if (v.maxTicketsPerOrder !== undefined) patch.maxTicketsPerOrder = v.maxTicketsPerOrder;
    if (v.salesCloseAt !== undefined) patch.salesCloseAt = v.salesCloseAt ?? null;
    if (v.nominativeTickets !== undefined) patch.nominativeTickets = v.nominativeTickets;
    if (v.ticketingStatus === "open") {
      const active = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.ticketTypes)
        .where(and(eq(schema.ticketTypes.eventId, eventId), eq(schema.ticketTypes.status, "active")));
      if ((active[0]?.n ?? 0) === 0)
        throw new PreconditionFailedError("Ajoutez au moins un tarif avant d'ouvrir les ventes.");
      if (event.status !== "published")
        throw new PreconditionFailedError("Publiez l'événement avant d'ouvrir les ventes.");
      patch.ticketingStatus = "open";
    } else if (v.ticketingStatus === "closed") {
      patch.ticketingStatus = "closed";
    }
    if (Object.keys(patch).length > 0) {
      await tx.update(schema.events).set(patch).where(eq(schema.events.id, eventId));
      await recordAudit(tx, actor, {
        organizationId,
        action: "ticketing.settings_changed",
        targetType: "event",
        targetId: eventId,
        metadata: { fields: Object.keys(patch), ticketingStatus: patch.ticketingStatus ?? null },
      });
    }
    const e = await assertEvent(tx, organizationId, eventId);
    return {
      ticketingStatus: e.ticketingStatus,
      maxTicketsPerOrder: e.maxTicketsPerOrder,
      salesCloseAt: e.salesCloseAt,
      nominativeTickets: e.nominativeTickets,
      capacity: e.capacity,
      currency: e.currency,
    };
  });
}

/* ------------------------------------------------------------------------- */
/* promo codes                                                                */
/* ------------------------------------------------------------------------- */

export interface PromoCodeView {
  id: string;
  code: string;
  kind: "percent" | "amount";
  value: number;
  maxRedemptions: number | null;
  redemptions: number;
  validFrom: Date | null;
  validUntil: Date | null;
  active: boolean;
}

export async function listPromoCodes(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<PromoCodeView[]> {
  await requirePermission(db, actor, "tickets.manage", { organizationId, eventId });
  const rows = await db
    .select({
      code: schema.promoCodes,
      redemptions: sql<number>`(select count(*)::int from ${schema.promoRedemptions} r where r.promo_code_id = ${schema.promoCodes.id})`,
    })
    .from(schema.promoCodes)
    .where(and(eq(schema.promoCodes.eventId, eventId), eq(schema.promoCodes.organizationId, organizationId)))
    .orderBy(asc(schema.promoCodes.createdAt));
  return rows.map((r) => ({
    id: r.code.id,
    code: r.code.code,
    kind: r.code.kind,
    value: r.code.value,
    maxRedemptions: r.code.maxRedemptions,
    redemptions: r.redemptions,
    validFrom: r.code.validFrom,
    validUntil: r.code.validUntil,
    active: r.code.active,
  }));
}

export async function createPromoCode(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  input: PromoCodeInput,
): Promise<PromoCodeView> {
  await requirePermission(db, actor, "tickets.manage", { organizationId, eventId });
  const v = promoCodeSchema.parse(input);
  await assertEvent(db, organizationId, eventId);
  const existing = await db
    .select({ id: schema.promoCodes.id })
    .from(schema.promoCodes)
    .where(and(eq(schema.promoCodes.eventId, eventId), eq(schema.promoCodes.code, v.code)))
    .limit(1);
  if (existing[0]) throw new ConflictError("Ce code existe déjà pour cet événement.", { field: "code" });
  const [row] = await db
    .insert(schema.promoCodes)
    .values({
      organizationId,
      eventId,
      code: v.code,
      kind: v.kind,
      value: v.value,
      maxRedemptions: v.maxRedemptions ?? null,
      validFrom: v.validFrom ?? null,
      validUntil: v.validUntil ?? null,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  await recordAudit(db, actor, {
    organizationId,
    action: "promo_code.created",
    targetType: "promo_code",
    targetId: row.id,
    metadata: { eventId, code: v.code, kind: v.kind, value: v.value },
  });
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    maxRedemptions: row.maxRedemptions,
    redemptions: 0,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    active: row.active,
  };
}

export async function setPromoCodeActive(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  promoCodeId: string,
  active: boolean,
): Promise<void> {
  await requirePermission(db, actor, "tickets.manage", { organizationId, eventId });
  const updated = await db
    .update(schema.promoCodes)
    .set({ active })
    .where(
      and(
        eq(schema.promoCodes.id, promoCodeId),
        eq(schema.promoCodes.eventId, eventId),
        eq(schema.promoCodes.organizationId, organizationId),
      ),
    )
    .returning({ id: schema.promoCodes.id });
  if (updated.length === 0) throw new NotFoundError("Code promo", promoCodeId);
  await recordAudit(db, actor, {
    organizationId,
    action: active ? "promo_code.activated" : "promo_code.deactivated",
    targetType: "promo_code",
    targetId: promoCodeId,
  });
}

/* ------------------------------------------------------------------------- */
/* public read                                                                */
/* ------------------------------------------------------------------------- */

export interface PublicTicketType {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  unitFeeMinor: number;
  currency: string;
  minPerOrder: number;
  maxPerOrder: number;
  /** null = unbounded */
  available: number | null;
  /** upcoming | on_sale | ended | sold_out */
  saleState: "upcoming" | "on_sale" | "ended" | "sold_out";
  salesStartAt: Date | null;
  salesEndAt: Date | null;
}

export interface PublicTicketing {
  open: boolean;
  /** Human reason when not open (ventes fermées, pas encore ouvertes, événement terminé…). */
  closedReason: string | null;
  maxTicketsPerOrder: number;
  nominativeTickets: boolean;
  currency: string;
  types: PublicTicketType[];
}

export function saleStateOf(
  t: { salesStartAt: Date | null; salesEndAt: Date | null; available: number | null },
  now: Date,
): PublicTicketType["saleState"] {
  if (t.salesStartAt && t.salesStartAt.getTime() > now.getTime()) return "upcoming";
  if (t.salesEndAt && t.salesEndAt.getTime() <= now.getTime()) return "ended";
  if (t.available !== null && t.available <= 0) return "sold_out";
  return "on_sale";
}

/** What the public ticket page shows: visible, active types with live availability. */
export async function getPublicTicketing(
  db: DbExecutor,
  organizationId: string,
  eventId: string,
  fees: FeePolicy,
  now = new Date(),
): Promise<PublicTicketing> {
  const event = await assertEvent(db, organizationId, eventId);
  const rows = (await loadTypeRows(db, eventId)).filter((r) => r.type.status === "active" && !r.type.hidden);
  const availability = computeAvailability(
    await loadTypeRows(db, eventId),
    await loadCounters(db, eventId, now),
    event.capacity,
  );
  let closedReason: string | null = null;
  if (event.status !== "published") closedReason = "Cet événement n'est pas ouvert à la vente.";
  else if (event.ticketingStatus === "not_configured") closedReason = "La billetterie n'est pas encore ouverte.";
  else if (event.ticketingStatus === "closed") closedReason = "Les ventes sont closes.";
  else if ((event.salesCloseAt ?? event.startsAt).getTime() <= now.getTime())
    closedReason = "Les ventes en ligne sont terminées.";
  return {
    open: closedReason === null,
    closedReason,
    maxTicketsPerOrder: event.maxTicketsPerOrder,
    nominativeTickets: event.nominativeTickets,
    currency: event.currency,
    types: rows.map((r) => {
      const a = availability.get(r.type.id) ?? { sold: 0, held: 0, available: null };
      return {
        id: r.type.id,
        name: r.type.name,
        description: r.type.description,
        priceMinor: r.type.priceMinor,
        unitFeeMinor: unitFee(r.type.priceMinor, fees),
        currency: r.type.currency,
        minPerOrder: r.type.minPerOrder,
        maxPerOrder: r.type.maxPerOrder,
        available: a.available,
        saleState: saleStateOf(
          { salesStartAt: r.type.salesStartAt, salesEndAt: r.type.salesEndAt, available: a.available },
          now,
        ),
        salesStartAt: r.type.salesStartAt,
        salesEndAt: r.type.salesEndAt,
      };
    }),
  };
}

export type { TypeRow };
export { loadTypeRows };
