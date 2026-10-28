import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { type Actor, NotFoundError, PreconditionFailedError } from "../kernel";
import { emitDomainEvent } from "../outbox";
import type { TicketingContext } from "./context";
import { sendRefundNotice } from "./emails";
import { recordRefundLedger } from "./ledger";
import { getOrder, loadOrderUnchecked, lockOrder, type OrderView } from "./orders";
import { allocateDiscount } from "./pricing";
import { type RefundRequestInput, refundRequestSchema } from "./schemas";
import { orderStateMachine, paymentStateMachine, ticketStateMachine } from "./state-machines";

/**
 * Refund amount of a set of tickets: price − allocated share of the order discount + fee.
 * Fees are refunded with the ticket (buyer-friendly default; the platform commission is
 * reversed at the provider with `refund_application_fee`).
 */
async function ticketAmounts(tx: DbExecutor, order: typeof schema.orders.$inferSelect, ticketIds: string[]) {
  const all = await tx
    .select({
      id: schema.tickets.id,
      price: schema.tickets.priceMinor,
      fee: schema.tickets.feeMinor,
      status: schema.tickets.status,
      number: schema.tickets.number,
    })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.orderId, order.id), inArray(schema.tickets.status, ["valid", "used", "refunded"])))
    .orderBy(schema.tickets.number);
  const shares = allocateDiscount(
    all.map((t) => t.price),
    order.discountMinor,
  );
  const byId = new Map(all.map((t, i) => [t.id, { ...t, discount: shares[i] ?? 0 }]));
  return ticketIds.map((id) => {
    const t = byId.get(id);
    if (!t) throw new NotFoundError("Billet", id);
    return t;
  });
}

/**
 * Apply a refund that the provider confirmed (or a free-order refund): tickets → refunded,
 * payment and order statuses, ledger, audit, outbox. Idempotent: a refund already applied
 * (status succeeded) is left untouched.
 */
export async function applyRefund(
  tx: DbExecutor,
  actor: Actor,
  refundId: string,
  now = new Date(),
): Promise<{ applied: boolean; order: OrderView }> {
  const rows = await tx.select().from(schema.refunds).where(eq(schema.refunds.id, refundId)).limit(1).for("update");
  const refund = rows[0];
  if (!refund) throw new NotFoundError("Remboursement", refundId);
  const order = await lockOrder(tx, refund.orderId);
  if (refund.status === "succeeded") return { applied: false, order: await loadOrderUnchecked(tx, order.id) };
  const items = await tx.select().from(schema.refundItems).where(eq(schema.refundItems.refundId, refundId));
  for (const item of items) {
    const t = await tx
      .select({ status: schema.tickets.status })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, item.ticketId))
      .limit(1);
    const status = t[0]?.status;
    if (status && status !== "refunded") {
      ticketStateMachine.transition(status, "refunded", { actor: actor.kind });
      await tx
        .update(schema.tickets)
        .set({ status: "refunded", refundedAt: now })
        .where(eq(schema.tickets.id, item.ticketId));
    }
  }
  let feePart = 0;
  if (refund.paymentId) {
    const pRows = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, refund.paymentId))
      .limit(1)
      .for("update");
    const p = pRows[0];
    if (p) {
      const refunded = p.refundedMinor + refund.amountMinor;
      const next = refunded >= p.amountMinor ? "refunded" : "partially_refunded";
      if (p.status !== next) paymentStateMachine.transition(p.status, next, { actor: actor.kind });
      // Fee part refunded proportionally to the ticket fees in the refund items.
      const tickets =
        items.length > 0
          ? await tx
              .select({ fee: schema.tickets.feeMinor })
              .from(schema.tickets)
              .where(
                inArray(
                  schema.tickets.id,
                  items.map((i) => i.ticketId),
                ),
              )
          : [];
      feePart =
        items.length > 0 ? tickets.reduce((a, t) => a + t.fee, 0) : Math.min(p.applicationFeeMinor, refund.amountMinor);
      await tx
        .update(schema.payments)
        .set({ refundedMinor: refunded, status: next })
        .where(eq(schema.payments.id, p.id));
    }
  }
  const remaining = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.orderId, order.id), inArray(schema.tickets.status, ["valid", "used"])));
  const nextOrder = (remaining[0]?.n ?? 0) === 0 ? "refunded" : "partially_refunded";
  if (order.status !== nextOrder) orderStateMachine.transition(order.status, nextOrder, { actor: actor.kind });
  await tx
    .update(schema.orders)
    .set({ status: nextOrder, version: sql`${schema.orders.version} + 1` })
    .where(eq(schema.orders.id, order.id));
  await tx.update(schema.refunds).set({ status: "succeeded", succeededAt: now }).where(eq(schema.refunds.id, refundId));
  if (refund.amountMinor > 0) {
    await recordRefundLedger(tx, order, {
      id: refund.id,
      amountMinor: refund.amountMinor,
      ticketPartMinor: refund.amountMinor - feePart,
      feePartMinor: feePart,
    });
  }
  await recordAudit(tx, actor, {
    organizationId: order.organizationId,
    action: "order.refunded",
    targetType: "order",
    targetId: order.id,
    reason: refund.reason,
    metadata: {
      refundId,
      amountMinor: refund.amountMinor,
      tickets: items.map((i) => i.ticketId),
      orderStatus: nextOrder,
    },
  });
  await emitDomainEvent(tx, {
    aggregateType: "order",
    aggregateId: order.id,
    eventType: "order.refunded",
    organizationId: order.organizationId,
    payload: { refundId, amountMinor: refund.amountMinor, number: order.number },
  });
  return { applied: true, order: await loadOrderUnchecked(tx, order.id) };
}

/**
 * Organizer refund: full order or selected tickets. The amount can never exceed what was
 * collected minus what was already refunded (checked under the payment row lock). Paid
 * orders go through the provider; free orders are refunded (tickets invalidated) directly.
 */
export async function createRefund(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  orderId: string,
  input: RefundRequestInput,
): Promise<OrderView> {
  const v = refundRequestSchema.parse(input);
  const view = await getOrder(db, actor, organizationId, orderId);
  await requirePermission(db, actor, "orders.refund", { organizationId, eventId: view.event.id });
  if (!["paid", "partially_refunded"].includes(view.status)) {
    throw new PreconditionFailedError("Seule une commande payée peut être remboursée.", {
      code: "order_not_refundable",
    });
  }
  const plan = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const refundable = await tx
      .select({ id: schema.tickets.id })
      .from(schema.tickets)
      .where(and(eq(schema.tickets.orderId, orderId), inArray(schema.tickets.status, ["valid", "used"])));
    const ticketIds = v.full ? refundable.map((t) => t.id) : (v.ticketIds ?? []);
    if (ticketIds.length === 0)
      throw new PreconditionFailedError("Aucun billet remboursable.", { code: "nothing_to_refund" });
    const amounts = await ticketAmounts(tx, order, ticketIds);
    for (const t of amounts) {
      if (t.status === "refunded")
        throw new PreconditionFailedError(`Le billet ${t.number} est déjà remboursé.`, { code: "already_refunded" });
    }
    const total = amounts.reduce((a, t) => a + (t.price - t.discount + t.fee), 0);
    const payments = await tx
      .select()
      .from(schema.payments)
      .where(
        and(eq(schema.payments.orderId, orderId), inArray(schema.payments.status, ["succeeded", "partially_refunded"])),
      )
      .limit(1)
      .for("update");
    const payment = payments[0] ?? null;
    if (order.totalMinor > 0) {
      if (!payment)
        throw new PreconditionFailedError("Aucun paiement encaissé pour cette commande.", { code: "no_payment" });
      if (total > payment.amountMinor - payment.refundedMinor) {
        throw new PreconditionFailedError("Le montant dépasse ce qui peut encore être remboursé.", {
          code: "refund_exceeds_payment",
        });
      }
      if (!payment.providerChargeRef)
        throw new PreconditionFailedError("Référence de paiement indisponible : réessayez dans quelques minutes.", {
          code: "charge_ref_missing",
        });
    }
    const [refund] = await tx
      .insert(schema.refunds)
      .values({
        organizationId,
        orderId,
        paymentId: payment?.id ?? null,
        amountMinor: Math.max(total, 0),
        reason: v.reason,
        status: "pending",
        requestedBy: actor.kind === "user" ? actor.userId : null,
      })
      .returning();
    if (!refund) throw new Error("refund insert failed");
    await tx.insert(schema.refundItems).values(
      amounts.map((t) => ({
        organizationId,
        refundId: refund.id,
        ticketId: t.id,
        amountMinor: t.price - t.discount + t.fee,
      })),
    );
    await recordAudit(tx, actor, {
      organizationId,
      action: "refund.requested",
      targetType: "refund",
      targetId: refund.id,
      reason: v.reason,
      metadata: { orderId, amountMinor: refund.amountMinor, tickets: ticketIds },
    });
    return {
      refundId: refund.id,
      amountMinor: refund.amountMinor,
      payment,
      order,
      ticketNumbers: amounts.map((t) => t.number),
    };
  });

  let applied: OrderView | null = null;
  if (plan.amountMinor === 0 || !plan.payment) {
    applied = (await db.transaction((tx) => applyRefund(tx, actor, plan.refundId))).order;
  } else {
    const account = await db
      .select({ providerAccountId: schema.paymentAccounts.providerAccountId })
      .from(schema.paymentAccounts)
      .where(
        and(
          eq(schema.paymentAccounts.organizationId, organizationId),
          eq(schema.paymentAccounts.provider, ctx.provider.name),
        ),
      )
      .limit(1);
    let result: Awaited<ReturnType<typeof ctx.provider.createRefund>>;
    try {
      result = await ctx.provider.createRefund({
        connectedAccountId: account[0]?.providerAccountId ?? "",
        chargeRef: plan.payment.providerChargeRef ?? "",
        amount: { amountMinor: plan.amountMinor, currency: plan.order.currency as "EUR" | "CHF" },
        idempotencyKey: plan.refundId,
        reason: v.reason,
      });
    } catch (error) {
      await db
        .update(schema.refunds)
        .set({
          status: "failed",
          failedAt: new Date(),
          failureReason: error instanceof Error ? error.message : "provider_error",
        })
        .where(eq(schema.refunds.id, plan.refundId));
      throw new PreconditionFailedError("Le prestataire de paiement a refusé le remboursement. Réessayez plus tard.", {
        code: "provider_refund_failed",
      });
    }
    await db
      .update(schema.refunds)
      .set({ providerRef: result.providerRefundId })
      .where(eq(schema.refunds.id, plan.refundId));
    if (result.status === "succeeded") {
      applied = (await db.transaction((tx) => applyRefund(tx, actor, plan.refundId))).order;
    } else if (result.status === "failed") {
      await db
        .update(schema.refunds)
        .set({ status: "failed", failedAt: new Date() })
        .where(eq(schema.refunds.id, plan.refundId));
      throw new PreconditionFailedError("Le remboursement a échoué chez le prestataire.", {
        code: "provider_refund_failed",
      });
    }
    // pending: the refund.succeeded webhook will apply it.
  }
  if (applied) {
    await sendRefundNotice(ctx, applied, {
      amountMinor: plan.amountMinor,
      reason: v.reason,
      ticketNumbers: plan.ticketNumbers,
    });
    return applied;
  }
  return loadOrderUnchecked(db, orderId);
}
