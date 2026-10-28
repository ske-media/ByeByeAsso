import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { recordTouchpoint } from "../crm";
import { type Actor, ForbiddenError, NotFoundError, newId, PreconditionFailedError } from "../kernel";
import { hasActiveMembership } from "../memberships/memberships";
import { emitDomainEvent } from "../outbox";
import {
  DEFAULT_HOLD_MINUTES,
  deriveToken,
  hashToken,
  type TicketingContext,
  TOKEN_SCOPES,
  tokensEqual,
} from "./context";
import { sendOrderConfirmation, sendPaymentFailed } from "./emails";
import { recordOrderPaidLedger } from "./ledger";
import { allocateDiscount, computeTotals, type PricedLine, unitFee } from "./pricing";
import {
  type BuyerDetailsInput,
  buyerDetailsSchema,
  type CreatePublicOrderInput,
  createPublicOrderSchema,
  type ListOrdersInput,
  listOrdersSchema,
} from "./schemas";
import { type OrderStatus, orderStateMachine, paymentStateMachine, type TicketStatus } from "./state-machines";
import { computeAvailability, loadCounters, loadTypeRows, saleStateOf } from "./ticket-types";

/* ------------------------------------------------------------------------- */
/* views                                                                      */
/* ------------------------------------------------------------------------- */

export interface OrderTicketView {
  id: string;
  number: string;
  attendeeName: string | null;
  status: TicketStatus;
  typeLabel: string;
  ticketTypeId: string;
  priceMinor: number;
  feeMinor: number;
  usedAt: Date | null;
}

export interface OrderView {
  id: string;
  number: string;
  status: OrderStatus;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  event: {
    id: string;
    slug: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    locationName: string | null;
    city: string | null;
    nominativeTickets: boolean;
  };
  buyer: { email: string; firstName: string | null; lastName: string | null; userId: string | null };
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  feesMinor: number;
  totalMinor: number;
  promoCode: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  version: number;
  marketingOptIn: boolean;
  items: Array<{ ticketTypeId: string; label: string; quantity: number; unitPriceMinor: number; unitFeeMinor: number }>;
  tickets: OrderTicketView[];
  payment: {
    id: string;
    status: string;
    provider: string;
    methodLabel: string | null;
    amountMinor: number;
    refundedMinor: number;
    failureReason: string | null;
    chargeRef: string | null;
  } | null;
  refunds: Array<{
    id: string;
    amountMinor: number;
    reason: string;
    status: string;
    createdAt: Date;
    ticketIds: string[];
  }>;
  history: Array<{ at: Date; label: string }>;
}

/** Buyer-facing view: adds the links the buyer may open (derived, never stored). */
export interface BuyerOrderView extends OrderView {
  accessToken: string;
  ticketLinks: Record<string, string>;
}

export interface OrderListItem {
  id: string;
  number: string;
  status: OrderStatus;
  eventId: string;
  eventTitle: string;
  buyerEmail: string;
  buyerName: string;
  ticketsSummary: string;
  ticketCount: number;
  totalMinor: number;
  currency: string;
  createdAt: Date;
  paidAt: Date | null;
}

/* ------------------------------------------------------------------------- */
/* loaders                                                                    */
/* ------------------------------------------------------------------------- */

export async function loadOrderUnchecked(db: DbExecutor, orderId: string): Promise<OrderView> {
  const rows = await db
    .select({
      order: schema.orders,
      event: schema.events,
      organization: schema.organizations,
      location: schema.eventLocations,
      promo: schema.promoCodes,
    })
    .from(schema.orders)
    .innerJoin(schema.events, eq(schema.events.id, schema.orders.eventId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.orders.organizationId))
    .leftJoin(schema.eventLocations, eq(schema.eventLocations.id, schema.events.locationId))
    .leftJoin(schema.promoCodes, eq(schema.promoCodes.id, schema.orders.promoCodeId))
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Commande", orderId);
  const items = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .orderBy(asc(schema.orderItems.id));
  const tickets = await db
    .select({ ticket: schema.tickets, typeName: schema.ticketTypes.name })
    .from(schema.tickets)
    .innerJoin(schema.ticketTypes, eq(schema.ticketTypes.id, schema.tickets.ticketTypeId))
    .where(eq(schema.tickets.orderId, orderId))
    .orderBy(asc(schema.tickets.number));
  const payments = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.orderId, orderId))
    .orderBy(desc(schema.payments.createdAt));
  const refunds = await db
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.orderId, orderId))
    .orderBy(asc(schema.refunds.createdAt));
  const refundItems =
    refunds.length > 0
      ? await db
          .select()
          .from(schema.refundItems)
          .where(
            inArray(
              schema.refundItems.refundId,
              refunds.map((r) => r.id),
            ),
          )
      : [];
  // The authoritative payment is the succeeded one, otherwise the most recent attempt.
  const payment =
    payments.find((p) => ["succeeded", "partially_refunded", "refunded"].includes(p.status)) ?? payments[0] ?? null;
  const o = row.order;
  const history: Array<{ at: Date; label: string }> = [{ at: o.createdAt, label: "Places réservées" }];
  for (const p of payments.slice().reverse()) {
    if (p.succeededAt) history.push({ at: p.succeededAt, label: "Paiement confirmé" });
    if (p.failedAt)
      history.push({ at: p.failedAt, label: `Paiement refusé${p.failureReason ? ` · ${p.failureReason}` : ""}` });
  }
  if (o.paidAt && o.totalMinor === 0) history.push({ at: o.paidAt, label: "Commande gratuite confirmée" });
  for (const r of refunds) {
    history.push({
      at: r.succeededAt ?? r.createdAt,
      label:
        r.status === "succeeded"
          ? `Remboursement de ${(r.amountMinor / 100).toFixed(2)} ${o.currency}`
          : r.status === "failed"
            ? "Remboursement échoué"
            : "Remboursement en cours",
    });
  }
  for (const t of tickets) {
    if (t.ticket.usedAt) history.push({ at: t.ticket.usedAt, label: `Entrée · ${t.ticket.number}` });
  }
  history.sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    organizationId: o.organizationId,
    organizationName: row.organization.name,
    organizationSlug: row.organization.slug,
    event: {
      id: row.event.id,
      slug: row.event.slug,
      title: row.event.title,
      startsAt: row.event.startsAt,
      endsAt: row.event.endsAt,
      timezone: row.event.timezone,
      locationName: row.location?.name ?? null,
      city: row.location?.city ?? null,
      nominativeTickets: row.event.nominativeTickets,
    },
    buyer: { email: o.buyerEmail, firstName: o.buyerFirstName, lastName: o.buyerLastName, userId: o.userId },
    currency: o.currency,
    subtotalMinor: o.subtotalMinor,
    discountMinor: o.discountMinor,
    feesMinor: o.feesMinor,
    totalMinor: o.totalMinor,
    promoCode: row.promo?.code ?? null,
    expiresAt: o.expiresAt,
    paidAt: o.paidAt,
    createdAt: o.createdAt,
    version: o.version,
    marketingOptIn: o.marketingOptIn,
    items: items.map((i) => ({
      ticketTypeId: i.ticketTypeId,
      label: i.label,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
      unitFeeMinor: i.unitFeeMinor,
    })),
    tickets: tickets.map((t) => ({
      id: t.ticket.id,
      number: t.ticket.number,
      attendeeName: t.ticket.attendeeName,
      status: t.ticket.status,
      typeLabel: t.typeName,
      ticketTypeId: t.ticket.ticketTypeId,
      priceMinor: t.ticket.priceMinor,
      feeMinor: t.ticket.feeMinor,
      usedAt: t.ticket.usedAt,
    })),
    payment: payment
      ? {
          id: payment.id,
          status: payment.status,
          provider: payment.provider,
          methodLabel: payment.methodLabel,
          amountMinor: payment.amountMinor,
          refundedMinor: payment.refundedMinor,
          failureReason: payment.failureReason,
          chargeRef: payment.providerChargeRef,
        }
      : null,
    refunds: refunds.map((r) => ({
      id: r.id,
      amountMinor: r.amountMinor,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      ticketIds: refundItems.filter((i) => i.refundId === r.id).map((i) => i.ticketId),
    })),
    history,
  };
}

function withBuyerLinks(
  ctx: TicketingContext,
  view: OrderView,
  secretVersion: number,
  ticketVersions: Map<string, number>,
): BuyerOrderView {
  const ticketLinks: Record<string, string> = {};
  for (const t of view.tickets) {
    ticketLinks[t.id] = deriveToken(ctx.credentialSecret, TOKEN_SCOPES.ticketView, t.id, ticketVersions.get(t.id) ?? 1);
  }
  return {
    ...view,
    accessToken: deriveToken(ctx.credentialSecret, TOKEN_SCOPES.orderAccess, view.id, secretVersion),
    ticketLinks,
  };
}

async function ticketVersionsOf(db: DbExecutor, orderId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: schema.tickets.id, v: schema.tickets.secretVersion })
    .from(schema.tickets)
    .where(eq(schema.tickets.orderId, orderId));
  return new Map(rows.map((r) => [r.id, r.v]));
}

/**
 * Resolve a buyer's order from its access token (links) or from the signed-in owner.
 * Uniform 404 on any mismatch: nothing is disclosed about the order's existence.
 */
export async function getOrderForBuyer(
  db: DbExecutor,
  ctx: TicketingContext,
  orderId: string,
  auth: { accessToken?: string | null | undefined; actor?: Actor | undefined },
): Promise<BuyerOrderView> {
  const rows = await db
    .select({
      id: schema.orders.id,
      hash: schema.orders.accessTokenHash,
      userId: schema.orders.userId,
      v: schema.orders.secretVersion,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Commande", orderId);
  const byToken = auth.accessToken ? tokensEqual(hashToken(auth.accessToken), row.hash) : false;
  const byUser = auth.actor?.kind === "user" && row.userId !== null && auth.actor.userId === row.userId;
  if (!byToken && !byUser) throw new NotFoundError("Commande", orderId);
  const view = await loadOrderUnchecked(db, orderId);
  return withBuyerLinks(ctx, view, row.v, await ticketVersionsOf(db, orderId));
}

/* ------------------------------------------------------------------------- */
/* reservation (public)                                                       */
/* ------------------------------------------------------------------------- */

async function nextOrderNumber(tx: DbExecutor, organizationId: string): Promise<string> {
  // The organization row is locked by the caller; the count is therefore race-free.
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(eq(schema.orders.organizationId, organizationId));
  return `KR-${1000 + (rows[0]?.n ?? 0)}`;
}

/**
 * Create an order with a time-limited inventory hold. Runs under row locks (organization →
 * event) so two concurrent buyers can never both take the last seat. Tickets are created in
 * `pending` and only become `valid` when the order is paid.
 */
export async function createPublicOrder(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  input: CreatePublicOrderInput,
  now = new Date(),
): Promise<BuyerOrderView> {
  const v = createPublicOrderSchema.parse(input);
  const holdMinutes = ctx.holdMinutes ?? DEFAULT_HOLD_MINUTES;
  const orderId = await db.transaction(async (tx) => {
    const orgRows = await tx
      .select({
        id: schema.organizations.id,
        status: schema.organizations.status,
        currency: schema.organizationSettings.currency,
      })
      .from(schema.organizations)
      .innerJoin(schema.organizationSettings, eq(schema.organizationSettings.organizationId, schema.organizations.id))
      .where(eq(schema.organizations.slug, v.organizationSlug))
      .limit(1)
      .for("update", { of: schema.organizations });
    const org = orgRows[0];
    if (org?.status !== "active") throw new NotFoundError("Organisation", v.organizationSlug);
    const eventRows = await tx
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.organizationId, org.id), eq(schema.events.slug, v.eventSlug)))
      .limit(1)
      .for("update");
    const event = eventRows[0];
    if (!event || event.visibility === "private") throw new NotFoundError("Événement", v.eventSlug);
    if (event.status !== "published" || event.ticketingStatus !== "open") {
      throw new PreconditionFailedError("La billetterie de cet événement n'est pas ouverte.", {
        code: "ticketing_closed",
      });
    }
    if ((event.salesCloseAt ?? event.startsAt).getTime() <= now.getTime()) {
      throw new PreconditionFailedError("Les ventes en ligne sont terminées.", { code: "sales_closed" });
    }
    const rows = await loadTypeRows(tx, event.id);
    const availability = computeAvailability(rows, await loadCounters(tx, event.id, now), event.capacity);
    const lines: PricedLine[] = [];
    let totalQty = 0;
    const seen = new Set<string>();
    for (const item of v.items) {
      if (seen.has(item.ticketTypeId)) throw new PreconditionFailedError("Tarif en double dans la commande.");
      seen.add(item.ticketTypeId);
      const r = rows.find((x) => x.type.id === item.ticketTypeId && x.type.status === "active");
      if (!r) throw new NotFoundError("Tarif", item.ticketTypeId);
      const a = availability.get(r.type.id) ?? { sold: 0, held: 0, available: null };
      const state = saleStateOf(
        { salesStartAt: r.type.salesStartAt, salesEndAt: r.type.salesEndAt, available: a.available },
        now,
      );
      if (state === "upcoming")
        throw new PreconditionFailedError(`« ${r.type.name} » n'est pas encore en vente.`, {
          code: "not_on_sale",
          ticketTypeId: r.type.id,
        });
      if (state === "ended")
        throw new PreconditionFailedError(`Les ventes de « ${r.type.name} » sont terminées.`, {
          code: "not_on_sale",
          ticketTypeId: r.type.id,
        });
      if (item.quantity < r.type.minPerOrder || item.quantity > r.type.maxPerOrder) {
        throw new PreconditionFailedError(
          `« ${r.type.name} » : entre ${r.type.minPerOrder} et ${r.type.maxPerOrder} billet(s) par commande.`,
          { code: "quantity_out_of_range", ticketTypeId: r.type.id },
        );
      }
      if (a.available !== null && a.available < item.quantity) {
        throw new PreconditionFailedError(
          a.available === 0
            ? `« ${r.type.name} » est épuisé.`
            : `Il ne reste que ${a.available} place(s) pour « ${r.type.name} ».`,
          { code: "insufficient_inventory", ticketTypeId: r.type.id, available: a.available },
        );
      }
      totalQty += item.quantity;
      lines.push({
        ticketTypeId: r.type.id,
        label: r.type.name,
        quantity: item.quantity,
        unitPriceMinor: r.type.priceMinor,
        unitFeeMinor: unitFee(r.type.priceMinor, ctx.fees),
      });
    }
    if (totalQty > event.maxTicketsPerOrder) {
      throw new PreconditionFailedError(`Au plus ${event.maxTicketsPerOrder} billets par commande.`, {
        code: "max_per_order",
      });
    }
    const membersOnly = rows.filter((r) => r.type.membersOnly && seen.has(r.type.id));
    if (membersOnly.length > 0) {
      if (!v.email) {
        throw new PreconditionFailedError("Indiquez votre adresse d'adhérent pour ce tarif.", {
          code: "membership_email_required",
          ticketTypeId: membersOnly[0]?.type.id,
        });
      }
      if (!(await hasActiveMembership(tx, org.id, v.email, now))) {
        throw new PreconditionFailedError(
          "Ce tarif est réservé aux adhérents : aucune adhésion active pour cette adresse.",
          { code: "membership_required", ticketTypeId: membersOnly[0]?.type.id },
        );
      }
    }
    const totals = computeTotals(lines, null);
    const id = newId();
    const number = await nextOrderNumber(tx, org.id);
    const expiresAt = new Date(now.getTime() + holdMinutes * 60_000);
    await tx.insert(schema.orders).values({
      id,
      organizationId: org.id,
      eventId: event.id,
      number,
      status: "reserved",
      buyerEmail: v.email ?? `pending+${id}@kroov.invalid`,
      userId: actor.kind === "user" ? actor.userId : null,
      currency: org.currency,
      ...totals,
      accessTokenHash: hashToken(deriveToken(ctx.credentialSecret, TOKEN_SCOPES.orderAccess, id, 1)),
      secretVersion: 1,
      expiresAt,
    });
    await tx.insert(schema.orderItems).values(
      lines.map((l) => ({
        organizationId: org.id,
        orderId: id,
        ticketTypeId: l.ticketTypeId,
        label: l.label,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        unitFeeMinor: l.unitFeeMinor,
      })),
    );
    const [hold] = await tx
      .insert(schema.inventoryHolds)
      .values({ organizationId: org.id, eventId: event.id, orderId: id, status: "active", expiresAt })
      .returning({ id: schema.inventoryHolds.id });
    if (!hold) throw new Error("hold insert failed");
    await tx.insert(schema.inventoryHoldItems).values(
      lines.map((l) => ({
        organizationId: org.id,
        holdId: hold.id,
        ticketTypeId: l.ticketTypeId,
        quantity: l.quantity,
      })),
    );
    let seat = 0;
    const ticketRows: (typeof schema.tickets.$inferInsert)[] = [];
    for (const l of lines) {
      for (let i = 0; i < l.quantity; i += 1) {
        seat += 1;
        const ticketId = newId();
        ticketRows.push({
          id: ticketId,
          organizationId: org.id,
          eventId: event.id,
          orderId: id,
          ticketTypeId: l.ticketTypeId,
          number: `${number}-${String(seat).padStart(2, "0")}`,
          status: "pending",
          priceMinor: l.unitPriceMinor,
          feeMinor: l.unitFeeMinor,
          qrCredentialHash: hashToken(deriveToken(ctx.credentialSecret, TOKEN_SCOPES.ticketQr, ticketId, 1)),
          viewTokenHash: hashToken(deriveToken(ctx.credentialSecret, TOKEN_SCOPES.ticketView, ticketId, 1)),
          secretVersion: 1,
        });
      }
    }
    await tx.insert(schema.tickets).values(ticketRows);
    await recordAudit(tx, actor, {
      organizationId: org.id,
      action: "order.reserved",
      targetType: "order",
      targetId: id,
      metadata: { eventId: event.id, number, quantity: totalQty, totalMinor: totals.totalMinor },
    });
    return id;
  });
  const view = await loadOrderUnchecked(db, orderId);
  return withBuyerLinks(ctx, view, 1, await ticketVersionsOf(db, orderId));
}

/* ------------------------------------------------------------------------- */
/* buyer details + promo                                                      */
/* ------------------------------------------------------------------------- */

async function lockOrder(tx: DbExecutor, orderId: string) {
  const rows = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1).for("update");
  const o = rows[0];
  if (!o) throw new NotFoundError("Commande", orderId);
  return o;
}

function assertEditable(o: typeof schema.orders.$inferSelect, now: Date): void {
  if (!["reserved", "awaiting_payment", "failed"].includes(o.status)) {
    throw new PreconditionFailedError("Cette commande ne peut plus être modifiée.", {
      code: "order_locked",
      status: o.status,
    });
  }
  if (o.expiresAt && o.expiresAt.getTime() <= now.getTime()) {
    throw new PreconditionFailedError("La réservation a expiré.", { code: "order_expired" });
  }
}

export async function updateBuyerDetails(
  db: Database,
  ctx: TicketingContext,
  orderId: string,
  accessToken: string,
  input: BuyerDetailsInput,
  now = new Date(),
): Promise<BuyerOrderView> {
  const v = buyerDetailsSchema.parse(input);
  await getOrderForBuyer(db, ctx, orderId, { accessToken });
  await db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    assertEditable(o, now);
    const restricted = await tx
      .select({ id: schema.orderItems.id })
      .from(schema.orderItems)
      .innerJoin(schema.ticketTypes, eq(schema.ticketTypes.id, schema.orderItems.ticketTypeId))
      .where(and(eq(schema.orderItems.orderId, orderId), eq(schema.ticketTypes.membersOnly, true)))
      .limit(1);
    if (
      restricted.length > 0 &&
      v.email !== o.buyerEmail &&
      !(await hasActiveMembership(tx, o.organizationId, v.email, now))
    ) {
      throw new PreconditionFailedError(
        "Cette commande contient un tarif adhérent : l'adresse doit porter une adhésion active.",
        { code: "membership_required", field: "email" },
      );
    }
    await tx
      .update(schema.orders)
      .set({
        buyerEmail: v.email,
        buyerFirstName: v.firstName,
        buyerLastName: v.lastName,
        marketingOptIn: v.marketingOptIn ?? false,
        version: sql`${schema.orders.version} + 1`,
      })
      .where(eq(schema.orders.id, orderId));
    if (v.attendees) {
      const tickets = await tx
        .select({ id: schema.tickets.id, ticketTypeId: schema.tickets.ticketTypeId })
        .from(schema.tickets)
        .where(and(eq(schema.tickets.orderId, orderId), eq(schema.tickets.status, "pending")))
        .orderBy(asc(schema.tickets.number));
      for (const group of v.attendees) {
        const of = tickets.filter((t) => t.ticketTypeId === group.ticketTypeId);
        for (let i = 0; i < Math.min(of.length, group.names.length); i += 1) {
          const t = of[i];
          const name = group.names[i];
          if (t && name) await tx.update(schema.tickets).set({ attendeeName: name }).where(eq(schema.tickets.id, t.id));
        }
      }
    }
  });
  return getOrderForBuyer(db, ctx, orderId, { accessToken });
}

export async function applyPromoCode(
  db: Database,
  ctx: TicketingContext,
  orderId: string,
  accessToken: string,
  code: string,
  now = new Date(),
): Promise<BuyerOrderView> {
  await getOrderForBuyer(db, ctx, orderId, { accessToken });
  await db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    assertEditable(o, now);
    const normalized = code.trim().toUpperCase();
    const rows = await tx
      .select({
        promo: schema.promoCodes,
        redemptions: sql<number>`(select count(*)::int from ${schema.promoRedemptions} r where r.promo_code_id = "promo_codes"."id")`,
      })
      .from(schema.promoCodes)
      .where(and(eq(schema.promoCodes.eventId, o.eventId), eq(schema.promoCodes.code, normalized)))
      .limit(1);
    const promo = rows[0];
    const invalid = () =>
      new PreconditionFailedError("Ce code n'est pas valable.", { code: "promo_invalid", field: "code" });
    if (!promo?.promo.active) throw invalid();
    if (promo.promo.validFrom && promo.promo.validFrom.getTime() > now.getTime()) throw invalid();
    if (promo.promo.validUntil && promo.promo.validUntil.getTime() <= now.getTime()) throw invalid();
    if (promo.promo.maxRedemptions !== null && promo.redemptions >= promo.promo.maxRedemptions) {
      throw new PreconditionFailedError("Ce code a atteint son nombre d'utilisations.", {
        code: "promo_exhausted",
        field: "code",
      });
    }
    const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    const totals = computeTotals(
      items.map((i) => ({
        ticketTypeId: i.ticketTypeId,
        label: i.label,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        unitFeeMinor: i.unitFeeMinor,
      })),
      { kind: promo.promo.kind, value: promo.promo.value },
    );
    await tx
      .update(schema.orders)
      .set({ ...totals, promoCodeId: promo.promo.id, version: sql`${schema.orders.version} + 1` })
      .where(eq(schema.orders.id, orderId));
  });
  return getOrderForBuyer(db, ctx, orderId, { accessToken });
}

/* ------------------------------------------------------------------------- */
/* paid / failed / expired transitions (used by checkout + webhooks + jobs)   */
/* ------------------------------------------------------------------------- */

export class LatePaymentNoInventoryError extends PreconditionFailedError {
  constructor() {
    super("Paiement reçu après l'expiration de la réservation et les places ne sont plus disponibles.", {
      code: "late_payment_no_inventory",
    });
    this.name = "LatePaymentNoInventoryError";
  }
}

/**
 * Mark an order paid inside the caller's transaction (order row already locked):
 * consume the hold (or re-check inventory when it expired — late payment), validate tickets,
 * record the promo redemption, write the ledger, audit, outbox. Idempotent on `paid`.
 */
export async function markOrderPaid(
  tx: DbExecutor,
  ctx: TicketingContext,
  actor: Actor,
  order: typeof schema.orders.$inferSelect,
  opts: { paymentId: string | null; now?: Date },
): Promise<{ alreadyPaid: boolean }> {
  const now = opts.now ?? new Date();
  if (["paid", "partially_refunded", "refunded"].includes(order.status)) return { alreadyPaid: true };
  orderStateMachine.transition(order.status, "paid", { actor: actor.kind });
  const holdRows = await tx
    .select()
    .from(schema.inventoryHolds)
    .where(eq(schema.inventoryHolds.orderId, order.id))
    .limit(1);
  const hold = holdRows[0];
  const holdAlive = hold?.status === "active" && hold.expiresAt.getTime() > now.getTime();
  if (!holdAlive) {
    // Late payment: the seats were released. Re-check inventory under the event lock.
    await tx
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, order.eventId))
      .for("update");
    const eventRows = await tx
      .select({ capacity: schema.events.capacity })
      .from(schema.events)
      .where(eq(schema.events.id, order.eventId))
      .limit(1);
    const rows = await loadTypeRows(tx, order.eventId);
    const availability = computeAvailability(
      rows,
      await loadCounters(tx, order.eventId, now),
      eventRows[0]?.capacity ?? 0,
    );
    const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    for (const i of items) {
      const a = availability.get(i.ticketTypeId);
      if (a && a.available !== null && a.available < i.quantity) throw new LatePaymentNoInventoryError();
    }
    // Revoked tickets (expired order) are replaced by fresh ones.
    const revoked = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.tickets)
      .where(and(eq(schema.tickets.orderId, order.id), eq(schema.tickets.status, "revoked")));
    if ((revoked[0]?.n ?? 0) > 0) {
      const existing = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.tickets)
        .where(eq(schema.tickets.orderId, order.id));
      let seat = existing[0]?.n ?? 0;
      const secret = ctx.credentialSecret;
      const inserts: (typeof schema.tickets.$inferInsert)[] = [];
      for (const i of items) {
        for (let k = 0; k < i.quantity; k += 1) {
          seat += 1;
          const ticketId = newId();
          inserts.push({
            id: ticketId,
            organizationId: order.organizationId,
            eventId: order.eventId,
            orderId: order.id,
            ticketTypeId: i.ticketTypeId,
            number: `${order.number}-${String(seat).padStart(2, "0")}`,
            status: "pending",
            priceMinor: i.unitPriceMinor,
            feeMinor: i.unitFeeMinor,
            qrCredentialHash: hashToken(deriveToken(secret, TOKEN_SCOPES.ticketQr, ticketId, 1)),
            viewTokenHash: hashToken(deriveToken(secret, TOKEN_SCOPES.ticketView, ticketId, 1)),
            secretVersion: 1,
          });
        }
      }
      await tx.insert(schema.tickets).values(inserts);
    }
  }
  if (hold && hold.status !== "consumed") {
    await tx
      .update(schema.inventoryHolds)
      .set({ status: "consumed", consumedAt: now })
      .where(eq(schema.inventoryHolds.id, hold.id));
  }
  await tx
    .update(schema.tickets)
    .set({ status: "valid", issuedAt: now })
    .where(and(eq(schema.tickets.orderId, order.id), eq(schema.tickets.status, "pending")));
  await tx
    .update(schema.orders)
    .set({ status: "paid", paidAt: now, expiresAt: null, version: sql`${schema.orders.version} + 1` })
    .where(eq(schema.orders.id, order.id));
  if (order.promoCodeId) {
    await tx
      .insert(schema.promoRedemptions)
      .values({
        organizationId: order.organizationId,
        promoCodeId: order.promoCodeId,
        orderId: order.id,
        discountMinor: order.discountMinor,
      })
      .onConflictDoNothing();
  }
  await recordOrderPaidLedger(tx, order);
  // CRM (phase 7): the buyer becomes/updates a contact of this organization, in the same transaction.
  await recordTouchpoint(tx, {
    organizationId: order.organizationId,
    source: "order",
    sourceId: order.id,
    sourceLabel: `commande ${order.number}`,
    email: order.buyerEmail,
    firstName: order.buyerFirstName,
    lastName: order.buyerLastName,
    userId: order.userId,
    occurredAt: now,
    marketingOptIn: order.marketingOptIn,
    customerRelationship: order.totalMinor > 0,
  });
  await recordAudit(tx, actor, {
    organizationId: order.organizationId,
    action: "order.paid",
    targetType: "order",
    targetId: order.id,
    metadata: { number: order.number, totalMinor: order.totalMinor, paymentId: opts.paymentId, late: !holdAlive },
  });
  await emitDomainEvent(tx, {
    aggregateType: "order",
    aggregateId: order.id,
    eventType: "order.paid",
    organizationId: order.organizationId,
    payload: { number: order.number, eventId: order.eventId, totalMinor: order.totalMinor },
  });
  return { alreadyPaid: false };
}

/** Expire overdue reservations (worker, every minute). Each order in its own transaction. */
export async function expireOverdueOrders(db: Database, actor: Actor, now = new Date()): Promise<number> {
  if (actor.kind !== "system") throw new ForbiddenError("system");
  const candidates = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(
      and(
        inArray(schema.orders.status, ["reserved", "awaiting_payment", "failed"]),
        sql`${schema.orders.expiresAt} is not null and ${schema.orders.expiresAt} <= ${now}`,
      ),
    )
    .limit(500);
  let count = 0;
  for (const c of candidates) {
    const done = await db.transaction(async (tx) => {
      const o = await lockOrder(tx, c.id);
      if (
        !["reserved", "awaiting_payment", "failed"].includes(o.status) ||
        !o.expiresAt ||
        o.expiresAt.getTime() > now.getTime()
      ) {
        return false;
      }
      orderStateMachine.transition(o.status, "expired", { actor: "system" });
      await tx
        .update(schema.orders)
        .set({ status: "expired", version: sql`${schema.orders.version} + 1` })
        .where(eq(schema.orders.id, o.id));
      await tx
        .update(schema.inventoryHolds)
        .set({ status: "released", releasedAt: now })
        .where(and(eq(schema.inventoryHolds.orderId, o.id), eq(schema.inventoryHolds.status, "active")));
      await tx
        .update(schema.tickets)
        .set({ status: "revoked", revokedAt: now })
        .where(and(eq(schema.tickets.orderId, o.id), eq(schema.tickets.status, "pending")));
      await recordAudit(tx, actor, {
        organizationId: o.organizationId,
        action: "order.expired",
        targetType: "order",
        targetId: o.id,
        metadata: { number: o.number },
      });
      return true;
    });
    if (done) count += 1;
  }
  return count;
}

/** Explicit "payment failed" transition used by webhooks (order lock held by caller). */
export async function markOrderFailed(
  tx: DbExecutor,
  actor: Actor,
  order: typeof schema.orders.$inferSelect,
  reason: string | null,
): Promise<void> {
  if (order.status !== "awaiting_payment") return;
  orderStateMachine.transition(order.status, "failed", { actor: actor.kind });
  await tx
    .update(schema.orders)
    .set({ status: "failed", version: sql`${schema.orders.version} + 1` })
    .where(eq(schema.orders.id, order.id));
  await recordAudit(tx, actor, {
    organizationId: order.organizationId,
    action: "order.payment_failed",
    targetType: "order",
    targetId: order.id,
    reason,
    metadata: { number: order.number },
  });
}

/* ------------------------------------------------------------------------- */
/* checkout                                                                   */
/* ------------------------------------------------------------------------- */

export type CheckoutResult = { kind: "paid" } | { kind: "redirect"; url: string; paymentId: string };

/**
 * Start payment for a reserved order. Free orders are paid immediately. Paid orders create a
 * provider checkout session on the organization's connected account and move to
 * `awaiting_payment`; the hold is extended so the buyer has the full window on the hosted page.
 * Nothing here issues tickets for a paid order — only the webhook does.
 */
export async function startCheckout(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  orderId: string,
  accessToken: string,
  urls: { successUrl: string; cancelUrl: string },
  now = new Date(),
): Promise<CheckoutResult> {
  await getOrderForBuyer(db, ctx, orderId, { accessToken, actor });
  const holdMinutes = ctx.holdMinutes ?? DEFAULT_HOLD_MINUTES;
  const result = await db.transaction(async (tx): Promise<CheckoutResult> => {
    const o = await lockOrder(tx, orderId);
    assertEditable(o, now);
    if (!o.buyerFirstName || !o.buyerLastName || o.buyerEmail.endsWith("@kroov.invalid")) {
      throw new PreconditionFailedError("Renseignez vos coordonnées avant le paiement.", {
        code: "buyer_details_required",
      });
    }
    const eventRows = await tx
      .select({ nominative: schema.events.nominativeTickets, title: schema.events.title })
      .from(schema.events)
      .where(eq(schema.events.id, o.eventId))
      .limit(1);
    const ev = eventRows[0];
    if (!ev) throw new NotFoundError("Événement", o.eventId);
    if (ev.nominative) {
      const missing = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.tickets)
        .where(
          and(
            eq(schema.tickets.orderId, orderId),
            eq(schema.tickets.status, "pending"),
            sql`${schema.tickets.attendeeName} is null`,
          ),
        );
      if ((missing[0]?.n ?? 0) > 0)
        throw new PreconditionFailedError("Indiquez le nom de chaque participant.", { code: "attendees_required" });
    }
    const restricted = await tx
      .select({ id: schema.orderItems.id })
      .from(schema.orderItems)
      .innerJoin(schema.ticketTypes, eq(schema.ticketTypes.id, schema.orderItems.ticketTypeId))
      .where(and(eq(schema.orderItems.orderId, orderId), eq(schema.ticketTypes.membersOnly, true)))
      .limit(1);
    if (restricted.length > 0 && !(await hasActiveMembership(tx, o.organizationId, o.buyerEmail, now))) {
      throw new PreconditionFailedError(
        "Ce tarif est réservé aux adhérents : aucune adhésion active pour cette adresse.",
        { code: "membership_required" },
      );
    }
    if (o.totalMinor === 0) {
      await markOrderPaid(tx, ctx, actor, o, { paymentId: null, now });
      return { kind: "paid" };
    }
    const accountRows = await tx
      .select()
      .from(schema.paymentAccounts)
      .where(
        and(
          eq(schema.paymentAccounts.organizationId, o.organizationId),
          eq(schema.paymentAccounts.provider, ctx.provider.name),
        ),
      )
      .limit(1);
    const account = accountRows[0];
    if (!account?.chargesEnabled || account.status !== "active") {
      throw new PreconditionFailedError("Le paiement en ligne n'est pas encore disponible pour cet organisateur.", {
        code: "payment_account_unavailable",
      });
    }
    const expiresAt = new Date(now.getTime() + holdMinutes * 60_000);
    const paymentId = newId();
    await tx.insert(schema.payments).values({
      id: paymentId,
      organizationId: o.organizationId,
      orderId,
      provider: ctx.provider.name,
      providerRef: `pending:${paymentId}`,
      status: "created",
      amountMinor: o.totalMinor,
      applicationFeeMinor: o.feesMinor,
      currency: o.currency,
    });
    const session = await ctx.provider.createCheckoutSession({
      orderId,
      orderNumber: o.number,
      connectedAccountId: account.providerAccountId,
      amount: { amountMinor: o.totalMinor, currency: o.currency as "EUR" | "CHF" },
      applicationFee: { amountMinor: o.feesMinor, currency: o.currency as "EUR" | "CHF" },
      customerEmail: o.buyerEmail,
      description: `${ev.title} · ${o.number}`,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
      expiresAt,
      idempotencyKey: paymentId,
    });
    paymentStateMachine.transition("created", "pending", { actor: actor.kind });
    await tx
      .update(schema.payments)
      .set({ providerRef: session.providerSessionId, status: "pending" })
      .where(eq(schema.payments.id, paymentId));
    await tx.insert(schema.paymentAttempts).values({
      organizationId: o.organizationId,
      paymentId,
      status: "pending",
      detail: { session: session.providerSessionId },
    });
    if (o.status !== "awaiting_payment")
      orderStateMachine.transition(o.status, "awaiting_payment", { actor: actor.kind });
    await tx
      .update(schema.orders)
      .set({ status: "awaiting_payment", expiresAt, version: sql`${schema.orders.version} + 1` })
      .where(eq(schema.orders.id, orderId));
    await tx
      .update(schema.inventoryHolds)
      .set({ expiresAt })
      .where(and(eq(schema.inventoryHolds.orderId, orderId), eq(schema.inventoryHolds.status, "active")));
    await recordAudit(tx, actor, {
      organizationId: o.organizationId,
      action: "order.checkout_started",
      targetType: "order",
      targetId: orderId,
      metadata: { paymentId, provider: ctx.provider.name },
    });
    return { kind: "redirect", url: session.redirectUrl, paymentId };
  });
  if (result.kind === "paid") {
    const view = await getOrderForBuyer(db, ctx, orderId, { accessToken, actor });
    await sendOrderConfirmation(ctx, view);
  }
  return result;
}

/* ------------------------------------------------------------------------- */
/* organizer reads                                                            */
/* ------------------------------------------------------------------------- */

export async function listOrders(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  input: ListOrdersInput = {},
): Promise<OrderListItem[]> {
  const v = listOrdersSchema.parse(input);
  await requirePermission(db, actor, "orders.read", { organizationId, eventId: v.eventId });
  const conditions = [
    eq(schema.orders.organizationId, organizationId),
    sql`${schema.orders.buyerEmail} not like '%@kroov.invalid'`,
  ];
  if (v.eventId) conditions.push(eq(schema.orders.eventId, v.eventId));
  if (v.status !== "all") conditions.push(eq(schema.orders.status, v.status));
  if (v.q) {
    const q = `%${v.q}%`;
    conditions.push(
      or(
        ilike(schema.orders.number, q),
        ilike(schema.orders.buyerEmail, q),
        ilike(schema.orders.buyerFirstName, q),
        ilike(schema.orders.buyerLastName, q),
      ) ?? sql`true`,
    );
  }
  const rows = await db
    .select({
      order: schema.orders,
      eventTitle: schema.events.title,
      summary: sql<string>`(select string_agg(i.quantity || ' × ' || i.label, ', ' order by i.label) from ${schema.orderItems} i where i.order_id = "orders"."id")`,
      count: sql<number>`(select coalesce(sum(i.quantity), 0)::int from ${schema.orderItems} i where i.order_id = "orders"."id")`,
    })
    .from(schema.orders)
    .innerJoin(schema.events, eq(schema.events.id, schema.orders.eventId))
    .where(and(...conditions))
    .orderBy(desc(schema.orders.createdAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.order.id,
    number: r.order.number,
    status: r.order.status,
    eventId: r.order.eventId,
    eventTitle: r.eventTitle,
    buyerEmail: r.order.buyerEmail,
    buyerName: [r.order.buyerFirstName, r.order.buyerLastName].filter(Boolean).join(" "),
    ticketsSummary: r.summary ?? "",
    ticketCount: r.count,
    totalMinor: r.order.totalMinor,
    currency: r.order.currency,
    createdAt: r.order.createdAt,
    paidAt: r.order.paidAt,
  }));
}

export async function getOrder(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  orderId: string,
): Promise<OrderView> {
  const rows = await db
    .select({ eventId: schema.orders.eventId })
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("Commande", orderId);
  try {
    await requirePermission(db, actor, "orders.read", { organizationId, eventId: rows[0].eventId });
  } catch (error) {
    if (error instanceof ForbiddenError) throw new NotFoundError("Commande", orderId);
    throw error;
  }
  return loadOrderUnchecked(db, orderId);
}

export interface TicketingStats {
  paidTickets: number;
  grossRevenueMinor: number;
  refundedMinor: number;
  pendingOrders: number;
  admitted: number;
  currency: string;
}

export async function ticketingStats(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId?: string,
): Promise<TicketingStats> {
  await requirePermission(db, actor, "orders.read", { organizationId, eventId });
  const scope = eventId
    ? and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.eventId, eventId))
    : eq(schema.orders.organizationId, organizationId);
  const [o] = await db
    .select({
      gross: sql<number>`coalesce(sum(case when ${schema.orders.status} in ('paid','partially_refunded','refunded') then ${schema.orders.subtotalMinor} - ${schema.orders.discountMinor} else 0 end), 0)::int`,
      pending: sql<number>`count(*) filter (where ${schema.orders.status} in ('reserved','awaiting_payment','failed') and ${schema.orders.expiresAt} > now())::int`,
    })
    .from(schema.orders)
    .where(scope);
  const tscope = eventId
    ? and(eq(schema.tickets.organizationId, organizationId), eq(schema.tickets.eventId, eventId))
    : eq(schema.tickets.organizationId, organizationId);
  const [t] = await db
    .select({
      paid: sql<number>`count(*) filter (where ${schema.tickets.status} in ('valid','used'))::int`,
      admitted: sql<number>`count(*) filter (where ${schema.tickets.status} = 'used')::int`,
      refunded: sql<number>`coalesce(sum(${schema.tickets.priceMinor}) filter (where ${schema.tickets.status} = 'refunded'), 0)::int`,
    })
    .from(schema.tickets)
    .where(tscope);
  const cur = await db
    .select({ currency: schema.organizationSettings.currency })
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.organizationId, organizationId))
    .limit(1);
  return {
    paidTickets: t?.paid ?? 0,
    grossRevenueMinor: o?.gross ?? 0,
    refundedMinor: t?.refunded ?? 0,
    pendingOrders: o?.pending ?? 0,
    admitted: t?.admitted ?? 0,
    currency: cur[0]?.currency ?? "EUR",
  };
}

/** Rotate the buyer links and send the confirmation again. Old links stop working. */
export async function resendOrderEmail(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  orderId: string,
): Promise<void> {
  const view = await getOrder(db, actor, organizationId, orderId);
  if (!["paid", "partially_refunded"].includes(view.status))
    throw new PreconditionFailedError("Seules les commandes payées peuvent être renvoyées.");
  const versions = await db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const nextOrder = o.secretVersion + 1;
    await tx
      .update(schema.orders)
      .set({
        secretVersion: nextOrder,
        accessTokenHash: hashToken(deriveToken(ctx.credentialSecret, TOKEN_SCOPES.orderAccess, orderId, nextOrder)),
      })
      .where(eq(schema.orders.id, orderId));
    const tickets = await tx
      .select({ id: schema.tickets.id, v: schema.tickets.secretVersion, status: schema.tickets.status })
      .from(schema.tickets)
      .where(eq(schema.tickets.orderId, orderId));
    const map = new Map<string, number>();
    for (const t of tickets) {
      const next = t.v + 1;
      await tx
        .update(schema.tickets)
        .set({
          secretVersion: next,
          viewTokenHash: hashToken(deriveToken(ctx.credentialSecret, TOKEN_SCOPES.ticketView, t.id, next)),
          qrCredentialHash: hashToken(deriveToken(ctx.credentialSecret, TOKEN_SCOPES.ticketQr, t.id, next)),
        })
        .where(eq(schema.tickets.id, t.id));
      map.set(t.id, next);
    }
    await recordAudit(tx, actor, {
      organizationId,
      action: "order.links_resent",
      targetType: "order",
      targetId: orderId,
      metadata: { number: o.number },
    });
    return { order: nextOrder, tickets: map };
  });
  const fresh = await loadOrderUnchecked(db, orderId);
  await sendOrderConfirmation(ctx, withBuyerLinks(ctx, fresh, versions.order, versions.tickets), { resend: true });
}

/** Orders of the signed-in user (by account or by verified e-mail). */
export async function listMyOrders(db: DbExecutor, actor: Actor, email: string): Promise<OrderListItem[]> {
  if (actor.kind !== "user") throw new ForbiddenError("user");
  const rows = await db
    .select({
      order: schema.orders,
      eventTitle: schema.events.title,
      summary: sql<string>`(select string_agg(i.quantity || ' × ' || i.label, ', ' order by i.label) from ${schema.orderItems} i where i.order_id = "orders"."id")`,
      count: sql<number>`(select coalesce(sum(i.quantity), 0)::int from ${schema.orderItems} i where i.order_id = "orders"."id")`,
    })
    .from(schema.orders)
    .innerJoin(schema.events, eq(schema.events.id, schema.orders.eventId))
    .where(
      and(
        or(eq(schema.orders.userId, actor.userId), eq(schema.orders.buyerEmail, email.toLowerCase())),
        inArray(schema.orders.status, ["paid", "partially_refunded", "refunded"]),
      ),
    )
    .orderBy(desc(schema.orders.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.order.id,
    number: r.order.number,
    status: r.order.status,
    eventId: r.order.eventId,
    eventTitle: r.eventTitle,
    buyerEmail: r.order.buyerEmail,
    buyerName: [r.order.buyerFirstName, r.order.buyerLastName].filter(Boolean).join(" "),
    ticketsSummary: r.summary ?? "",
    ticketCount: r.count,
    totalMinor: r.order.totalMinor,
    currency: r.order.currency,
    createdAt: r.order.createdAt,
    paidAt: r.order.paidAt,
  }));
}

/** Buyer view for a signed-in owner (no token needed). */
export async function getMyOrder(
  db: DbExecutor,
  ctx: TicketingContext,
  actor: Actor,
  email: string,
  orderId: string,
): Promise<BuyerOrderView> {
  if (actor.kind !== "user") throw new ForbiddenError("user");
  const rows = await db
    .select({
      id: schema.orders.id,
      userId: schema.orders.userId,
      email: schema.orders.buyerEmail,
      v: schema.orders.secretVersion,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  const row = rows[0];
  if (!row || (row.userId !== actor.userId && row.email !== email.toLowerCase()))
    throw new NotFoundError("Commande", orderId);
  return withBuyerLinks(ctx, await loadOrderUnchecked(db, orderId), row.v, await ticketVersionsOf(db, orderId));
}

export { allocateDiscount, lockOrder, sendPaymentFailed };

export interface TicketListItem {
  id: string;
  number: string;
  attendeeName: string | null;
  status: TicketStatus;
  typeLabel: string;
  orderId: string;
  orderNumber: string;
  buyerEmail: string;
  eventId: string;
  eventTitle: string;
  priceMinor: number;
  currency: string;
  usedAt: Date | null;
}

/** Participants: one row per issued ticket (valid, used, refunded), organizer side. */
export async function listTickets(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  input: { eventId?: string | undefined; q?: string | undefined } = {},
): Promise<TicketListItem[]> {
  await requirePermission(db, actor, "orders.read", { organizationId, eventId: input.eventId });
  const conditions = [
    eq(schema.tickets.organizationId, organizationId),
    inArray(schema.tickets.status, ["valid", "used", "refunded"]),
  ];
  if (input.eventId) conditions.push(eq(schema.tickets.eventId, input.eventId));
  if (input.q) {
    const q = `%${input.q}%`;
    conditions.push(
      or(ilike(schema.tickets.number, q), ilike(schema.tickets.attendeeName, q), ilike(schema.orders.buyerEmail, q)) ??
        sql`true`,
    );
  }
  const rows = await db
    .select({
      ticket: schema.tickets,
      typeLabel: schema.ticketTypes.name,
      orderNumber: schema.orders.number,
      buyerEmail: schema.orders.buyerEmail,
      currency: schema.orders.currency,
      eventTitle: schema.events.title,
    })
    .from(schema.tickets)
    .innerJoin(schema.ticketTypes, eq(schema.ticketTypes.id, schema.tickets.ticketTypeId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.tickets.orderId))
    .innerJoin(schema.events, eq(schema.events.id, schema.tickets.eventId))
    .where(and(...conditions))
    .orderBy(desc(schema.tickets.issuedAt), asc(schema.tickets.number))
    .limit(2000);
  return rows.map((r) => ({
    id: r.ticket.id,
    number: r.ticket.number,
    attendeeName: r.ticket.attendeeName,
    status: r.ticket.status,
    typeLabel: r.typeLabel,
    orderId: r.ticket.orderId,
    orderNumber: r.orderNumber,
    buyerEmail: r.buyerEmail,
    eventId: r.ticket.eventId,
    eventTitle: r.eventTitle,
    priceMinor: r.ticket.priceMinor,
    currency: r.currency,
    usedAt: r.ticket.usedAt,
  }));
}
