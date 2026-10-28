import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { type Actor, NotFoundError, PreconditionFailedError } from "../kernel";
import { activateMembershipFromPayment, notifyMembershipActivated } from "../memberships/memberships";
import type { ProviderEvent } from "../payments/port";
import { deriveToken, type TicketingContext, TOKEN_SCOPES } from "./context";
import { sendLatePaymentRefunded, sendOrderConfirmation, sendPaymentFailed } from "./emails";
import {
  getOrderForBuyer,
  LatePaymentNoInventoryError,
  loadOrderUnchecked,
  lockOrder,
  markOrderFailed,
  markOrderPaid,
} from "./orders";
import { applyRefund } from "./refunds";
import { paymentStateMachine } from "./state-machines";

/* ------------------------------------------------------------------------- */
/* payment accounts (Stripe Connect)                                           */
/* ------------------------------------------------------------------------- */

export interface PaymentAccountView {
  provider: "stripe" | "fake";
  providerAccountId: string;
  status: "pending" | "active" | "restricted" | "disconnected";
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  lastSyncedAt: Date | null;
}

function toAccountView(a: typeof schema.paymentAccounts.$inferSelect): PaymentAccountView {
  return {
    provider: a.provider,
    providerAccountId: a.providerAccountId,
    status: a.status,
    chargesEnabled: a.chargesEnabled,
    payoutsEnabled: a.payoutsEnabled,
    lastSyncedAt: a.lastSyncedAt,
  };
}

export async function getPaymentAccount(
  db: DbExecutor,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
): Promise<PaymentAccountView | null> {
  await requirePermission(db, actor, "organization.manage", { organizationId });
  const rows = await db
    .select()
    .from(schema.paymentAccounts)
    .where(
      and(
        eq(schema.paymentAccounts.organizationId, organizationId),
        eq(schema.paymentAccounts.provider, ctx.provider.name),
      ),
    )
    .limit(1);
  return rows[0] ? toAccountView(rows[0]) : null;
}

/** Create (or reuse) the connected account and return the hosted onboarding URL. */
export async function startPaymentOnboarding(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  urls: { returnUrl: string; refreshUrl: string },
): Promise<{ onboardingUrl: string; account: PaymentAccountView }> {
  await requirePermission(db, actor, "organization.manage", { organizationId });
  const org = await db
    .select({
      name: schema.organizations.name,
      country: schema.organizations.country,
      email: schema.organizationSettings.contactEmail,
    })
    .from(schema.organizations)
    .innerJoin(schema.organizationSettings, eq(schema.organizationSettings.organizationId, schema.organizations.id))
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  const o = org[0];
  if (!o) throw new NotFoundError("Organisation", organizationId);
  let account = (
    await db
      .select()
      .from(schema.paymentAccounts)
      .where(
        and(
          eq(schema.paymentAccounts.organizationId, organizationId),
          eq(schema.paymentAccounts.provider, ctx.provider.name),
        ),
      )
      .limit(1)
  )[0];
  if (!account) {
    const created = await ctx.provider.createConnectedAccount({
      organizationId,
      organizationName: o.name,
      email: o.email,
      country: o.country,
      idempotencyKey: `acct:${organizationId}`,
    });
    const [row] = await db
      .insert(schema.paymentAccounts)
      .values({
        organizationId,
        provider: ctx.provider.name,
        providerAccountId: created.providerAccountId,
        status: created.chargesEnabled ? "active" : "pending",
        chargesEnabled: created.chargesEnabled,
        payoutsEnabled: created.payoutsEnabled,
        lastSyncedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("payment account insert failed");
    account = row;
    await recordAudit(db, actor, {
      organizationId,
      action: "payment_account.created",
      targetType: "payment_account",
      targetId: row.id,
      metadata: { provider: ctx.provider.name },
    });
  }
  const onboardingUrl = await ctx.provider.createOnboardingLink({
    providerAccountId: account.providerAccountId,
    ...urls,
  });
  return { onboardingUrl, account: toAccountView(account) };
}

/** Re-fetch the account status from the provider (return from onboarding, webhook, manual refresh). */
export async function syncPaymentAccount(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
): Promise<PaymentAccountView> {
  if (actor.kind === "user") await requirePermission(db, actor, "organization.manage", { organizationId });
  const rows = await db
    .select()
    .from(schema.paymentAccounts)
    .where(
      and(
        eq(schema.paymentAccounts.organizationId, organizationId),
        eq(schema.paymentAccounts.provider, ctx.provider.name),
      ),
    )
    .limit(1);
  const account = rows[0];
  if (!account) throw new NotFoundError("Compte de paiement");
  const status = await ctx.provider.retrieveAccountStatus(account.providerAccountId);
  const next = status.chargesEnabled ? "active" : status.detailsSubmitted ? "restricted" : "pending";
  const [updated] = await db
    .update(schema.paymentAccounts)
    .set({
      status: next,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      lastSyncedAt: new Date(),
    })
    .where(eq(schema.paymentAccounts.id, account.id))
    .returning();
  if (!updated) throw new Error("payment account update failed");
  if (account.status !== next) {
    await recordAudit(db, actor, {
      organizationId,
      action: "payment_account.status_changed",
      targetType: "payment_account",
      targetId: account.id,
      metadata: { from: account.status, to: next },
    });
  }
  return toAccountView(updated);
}

/* ------------------------------------------------------------------------- */
/* webhooks                                                                   */
/* ------------------------------------------------------------------------- */

export type WebhookOutcome =
  | "applied"
  | "duplicate"
  | "ignored_unknown"
  | "ignored_out_of_order"
  | "ignored_already_paid"
  | "refunded_duplicate_payment"
  | "refunded_late_payment"
  | "error";

async function recordOutcome(db: DbExecutor, rowId: string, outcome: WebhookOutcome, error?: string): Promise<void> {
  await db
    .update(schema.paymentWebhookEvents)
    .set({ processedAt: new Date(), outcome, error: error ?? null })
    .where(eq(schema.paymentWebhookEvents.id, rowId));
}

/**
 * Process a verified provider event exactly once. The UNIQUE (provider, provider_event_id)
 * insert is the idempotency gate; everything else runs under the order row lock so duplicate
 * deliveries, out-of-order deliveries and late payments are resolved deterministically.
 */
export async function processProviderEvent(
  db: Database,
  ctx: TicketingContext,
  event: ProviderEvent,
): Promise<WebhookOutcome> {
  const inserted = await db
    .insert(schema.paymentWebhookEvents)
    .values({
      provider: ctx.provider.name,
      providerEventId: event.providerEventId,
      type: event.type,
      payload: event.raw,
    })
    .onConflictDoNothing()
    .returning({ id: schema.paymentWebhookEvents.id });
  const row = inserted[0];
  if (!row) return "duplicate";
  const actor: Actor = { kind: "webhook", provider: ctx.provider.name, eventId: event.providerEventId };
  try {
    let outcome: WebhookOutcome;
    switch (event.type) {
      case "payment.succeeded":
        outcome = await onPaymentSucceeded(db, ctx, actor, event);
        break;
      case "payment.failed":
      case "payment.cancelled":
        outcome = await onPaymentFailed(db, ctx, actor, event);
        break;
      case "refund.succeeded":
      case "refund.failed":
        outcome = await onRefundEvent(db, actor, event);
        break;
      case "account.updated":
        outcome = await onAccountUpdated(db, ctx, actor, event);
        break;
      default:
        outcome = "ignored_unknown";
    }
    await recordOutcome(db, row.id, outcome);
    return outcome;
  } catch (error) {
    await recordOutcome(db, row.id, "error", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function findPayment(tx: DbExecutor, provider: "stripe" | "fake", providerRef: string) {
  const rows = await tx
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.provider, provider), eq(schema.payments.providerRef, providerRef)))
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

async function onPaymentSucceeded(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  event: ProviderEvent,
): Promise<WebhookOutcome> {
  const result = await db.transaction(
    async (
      tx,
    ): Promise<{
      outcome: WebhookOutcome;
      orderId: string | null;
      membershipId?: string | undefined;
      refundAmount?: number | undefined;
      chargeRef?: string | undefined;
    }> => {
      const payment = await findPayment(tx, ctx.provider.name, event.providerObjectId);
      if (!payment) return { outcome: "ignored_unknown", orderId: null };
      if (payment.membershipId) {
        // Cotisation: activate the membership (same idempotency and ordering rules).
        if (["succeeded", "partially_refunded", "refunded"].includes(payment.status))
          return { outcome: "duplicate", orderId: null };
        paymentStateMachine.transition(payment.status, "succeeded", { actor: actor.kind });
        await tx
          .update(schema.payments)
          .set({
            status: "succeeded",
            succeededAt: event.occurredAt,
            providerChargeRef: event.chargeRef ?? payment.providerChargeRef,
            methodLabel: event.methodLabel ?? payment.methodLabel,
          })
          .where(eq(schema.payments.id, payment.id));
        const applied = await activateMembershipFromPayment(tx, actor, payment.membershipId, event.occurredAt);
        return { outcome: applied, orderId: null, membershipId: payment.membershipId };
      }
      if (!payment.orderId) return { outcome: "ignored_unknown", orderId: null };
      const order = await lockOrder(tx, payment.orderId);
      if (["succeeded", "partially_refunded", "refunded"].includes(payment.status))
        return { outcome: "duplicate", orderId: order.id };
      paymentStateMachine.transition(payment.status, "succeeded", { actor: actor.kind });
      await tx
        .update(schema.payments)
        .set({
          status: "succeeded",
          succeededAt: event.occurredAt,
          providerChargeRef: event.chargeRef ?? payment.providerChargeRef,
          methodLabel: event.methodLabel ?? payment.methodLabel,
        })
        .where(eq(schema.payments.id, payment.id));
      await tx.insert(schema.paymentAttempts).values({
        organizationId: payment.organizationId,
        paymentId: payment.id,
        status: "succeeded",
        providerEventId: event.providerEventId,
        occurredAt: event.occurredAt,
      });
      if (["paid", "partially_refunded", "refunded"].includes(order.status)) {
        // Duplicate checkout: another payment already paid this order → this one must be refunded.
        await recordAudit(tx, actor, {
          organizationId: order.organizationId,
          action: "payment.duplicate_detected",
          targetType: "payment",
          targetId: payment.id,
          metadata: { orderId: order.id },
        });
        return {
          outcome: "refunded_duplicate_payment",
          orderId: order.id,
          refundAmount: payment.amountMinor,
          chargeRef: event.chargeRef ?? payment.providerChargeRef ?? undefined,
        };
      }
      try {
        await markOrderPaid(tx, ctx, actor, order, { paymentId: payment.id, now: event.occurredAt });
        return { outcome: "applied", orderId: order.id };
      } catch (error) {
        if (error instanceof LatePaymentNoInventoryError) {
          await recordAudit(tx, actor, {
            organizationId: order.organizationId,
            action: "payment.late_without_inventory",
            targetType: "payment",
            targetId: payment.id,
            metadata: { orderId: order.id },
          });
          return {
            outcome: "refunded_late_payment",
            orderId: order.id,
            refundAmount: payment.amountMinor,
            chargeRef: event.chargeRef ?? payment.providerChargeRef ?? undefined,
          };
        }
        throw error;
      }
    },
  );
  if (result.membershipId && result.outcome === "applied") {
    await notifyMembershipActivated(db, ctx, result.membershipId);
    return result.outcome;
  }
  if (result.membershipId && result.outcome === "applied") {
    await notifyMembershipActivated(db, ctx, result.membershipId);
    return result.outcome;
  }
  if (!result.orderId) return result.outcome;
  if (result.outcome === "applied") {
    const secret = await db
      .select({ v: schema.orders.secretVersion })
      .from(schema.orders)
      .where(eq(schema.orders.id, result.orderId))
      .limit(1);
    const buyerView = await getOrderForBuyer(db, ctx, result.orderId, {
      accessToken: deriveOrderToken(ctx, result.orderId, secret[0]?.v ?? 1),
    });
    await sendOrderConfirmation(ctx, buyerView).catch(() => undefined);
  } else if (
    (result.outcome === "refunded_duplicate_payment" || result.outcome === "refunded_late_payment") &&
    result.refundAmount
  ) {
    await autoRefund(
      db,
      ctx,
      actor,
      result.orderId,
      event.providerObjectId,
      result.refundAmount,
      result.chargeRef,
      result.outcome,
    );
  }
  return result.outcome;
}

function deriveOrderToken(ctx: TicketingContext, orderId: string, version: number): string {
  return deriveToken(ctx.credentialSecret, TOKEN_SCOPES.orderAccess, orderId, version);
}

async function autoRefund(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  orderId: string,
  providerSessionId: string,
  amountMinor: number,
  chargeRef: string | undefined,
  why: "refunded_duplicate_payment" | "refunded_late_payment",
): Promise<void> {
  const order = await loadOrderUnchecked(db, orderId);
  const payment = (
    await db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.provider, ctx.provider.name), eq(schema.payments.providerRef, providerSessionId)))
      .limit(1)
  )[0];
  if (!payment) return;
  const account = (
    await db
      .select({ id: schema.paymentAccounts.providerAccountId })
      .from(schema.paymentAccounts)
      .where(
        and(
          eq(schema.paymentAccounts.organizationId, order.organizationId),
          eq(schema.paymentAccounts.provider, ctx.provider.name),
        ),
      )
      .limit(1)
  )[0];
  const reason =
    why === "refunded_duplicate_payment"
      ? "Paiement en double sur une commande déjà payée"
      : "Paiement reçu après expiration, places indisponibles";
  const [refund] = await db
    .insert(schema.refunds)
    .values({
      organizationId: order.organizationId,
      orderId,
      paymentId: payment.id,
      amountMinor,
      reason,
      status: "pending",
    })
    .returning();
  if (!refund) return;
  try {
    const res = await ctx.provider.createRefund({
      connectedAccountId: account?.id ?? "",
      chargeRef: chargeRef ?? "",
      amount: { amountMinor, currency: order.currency as "EUR" | "CHF" },
      idempotencyKey: refund.id,
      reason,
    });
    await db
      .update(schema.refunds)
      .set({
        providerRef: res.providerRefundId,
        status: res.status === "failed" ? "failed" : res.status === "succeeded" ? "succeeded" : "pending",
        succeededAt: res.status === "succeeded" ? new Date() : null,
      })
      .where(eq(schema.refunds.id, refund.id));
    if (res.status === "succeeded") {
      await db
        .update(schema.payments)
        .set({ status: "refunded", refundedMinor: amountMinor })
        .where(eq(schema.payments.id, payment.id));
    }
  } catch (error) {
    await db
      .update(schema.refunds)
      .set({
        status: "failed",
        failedAt: new Date(),
        failureReason: error instanceof Error ? error.message : "provider_error",
      })
      .where(eq(schema.refunds.id, refund.id));
  }
  await recordAudit(db, actor, {
    organizationId: order.organizationId,
    action: "payment.auto_refunded",
    targetType: "payment",
    targetId: payment.id,
    reason,
    metadata: { refundId: refund.id, amountMinor },
  });
  if (why === "refunded_late_payment") await sendLatePaymentRefunded(ctx, order).catch(() => undefined);
}

async function onPaymentFailed(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  event: ProviderEvent,
): Promise<WebhookOutcome> {
  const result = await db.transaction(async (tx): Promise<{ outcome: WebhookOutcome; orderId: string | null }> => {
    const payment = await findPayment(tx, ctx.provider.name, event.providerObjectId);
    if (!payment) return { outcome: "ignored_unknown", orderId: null };
    if (!payment.orderId) {
      // Membership cotisation refused: the membership simply keeps waiting for a new attempt.
      if (["succeeded", "partially_refunded", "refunded"].includes(payment.status))
        return { outcome: "ignored_out_of_order", orderId: null };
      const next = event.type === "payment.cancelled" ? "cancelled" : "failed";
      if (payment.status === next) return { outcome: "duplicate", orderId: null };
      paymentStateMachine.transition(payment.status, next, { actor: actor.kind });
      await tx
        .update(schema.payments)
        .set({ status: next, failedAt: event.occurredAt, failureReason: event.failureReason ?? null })
        .where(eq(schema.payments.id, payment.id));
      return { outcome: "applied", orderId: null };
    }
    const order = await lockOrder(tx, payment.orderId);
    if (["succeeded", "partially_refunded", "refunded"].includes(payment.status)) {
      await tx.insert(schema.paymentAttempts).values({
        organizationId: payment.organizationId,
        paymentId: payment.id,
        status: "failed",
        providerEventId: event.providerEventId,
        occurredAt: event.occurredAt,
        detail: { ignored: "out_of_order" },
      });
      return { outcome: "ignored_out_of_order", orderId: null };
    }
    const next = event.type === "payment.cancelled" ? "cancelled" : "failed";
    if (payment.status === next) return { outcome: "duplicate", orderId: null };
    paymentStateMachine.transition(payment.status, next, { actor: actor.kind });
    await tx
      .update(schema.payments)
      .set({ status: next, failedAt: event.occurredAt, failureReason: event.failureReason ?? null })
      .where(eq(schema.payments.id, payment.id));
    await tx.insert(schema.paymentAttempts).values({
      organizationId: payment.organizationId,
      paymentId: payment.id,
      status: next,
      providerEventId: event.providerEventId,
      occurredAt: event.occurredAt,
    });
    await markOrderFailed(tx, actor, order, event.failureReason ?? null);
    return { outcome: "applied", orderId: order.id };
  });
  if (result.orderId && event.type === "payment.failed") {
    const secret = await db
      .select({ v: schema.orders.secretVersion })
      .from(schema.orders)
      .where(eq(schema.orders.id, result.orderId))
      .limit(1);
    const view = await getOrderForBuyer(db, ctx, result.orderId, {
      accessToken: deriveOrderToken(ctx, result.orderId, secret[0]?.v ?? 1),
    });
    await sendPaymentFailed(ctx, view, event.failureReason ?? null).catch(() => undefined);
  }
  return result.outcome;
}

async function onRefundEvent(db: Database, actor: Actor, event: ProviderEvent): Promise<WebhookOutcome> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.providerRef, event.providerObjectId))
      .limit(1)
      .for("update");
    const refund = rows[0];
    if (!refund) return "ignored_unknown";
    if (event.type === "refund.failed") {
      if (refund.status === "succeeded") return "ignored_out_of_order";
      await tx
        .update(schema.refunds)
        .set({ status: "failed", failedAt: event.occurredAt, failureReason: event.failureReason ?? null })
        .where(eq(schema.refunds.id, refund.id));
      await recordAudit(tx, actor, {
        organizationId: refund.organizationId,
        action: "refund.failed",
        targetType: "refund",
        targetId: refund.id,
        metadata: { orderId: refund.orderId },
      });
      return "applied";
    }
    const { applied } = await applyRefund(tx, actor, refund.id, event.occurredAt);
    return applied ? "applied" : "duplicate";
  });
}

async function onAccountUpdated(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  event: ProviderEvent,
): Promise<WebhookOutcome> {
  const rows = await db
    .select({ organizationId: schema.paymentAccounts.organizationId })
    .from(schema.paymentAccounts)
    .where(
      and(
        eq(schema.paymentAccounts.provider, ctx.provider.name),
        eq(schema.paymentAccounts.providerAccountId, event.providerObjectId),
      ),
    )
    .limit(1);
  if (!rows[0]) return "ignored_unknown";
  await syncPaymentAccount(db, ctx, actor, rows[0].organizationId);
  return "applied";
}

/**
 * Reconcile payments stuck in `pending` (provider outage, lost webhook): ask the provider.
 * Runs from the worker; each payment is handled as if its webhook had arrived.
 */
export async function reconcilePendingPayments(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  olderThanMinutes = 15,
  now = new Date(),
): Promise<number> {
  if (actor.kind !== "system") throw new PreconditionFailedError("system only");
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000);
  const pending = await db
    .select({ id: schema.payments.id, providerRef: schema.payments.providerRef })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.provider, ctx.provider.name),
        inArray(schema.payments.status, ["pending"]),
        sql`${schema.payments.createdAt} < ${cutoff}`,
      ),
    )
    .limit(100);
  let n = 0;
  for (const p of pending) {
    const status = await ctx.provider.retrievePaymentStatus(p.providerRef).catch(() => null);
    if (!status || status.status === "pending") continue;
    const type =
      status.status === "succeeded"
        ? "payment.succeeded"
        : status.status === "cancelled"
          ? "payment.cancelled"
          : "payment.failed";
    await processProviderEvent(db, ctx, {
      providerEventId: `reconcile:${p.id}:${status.status}`,
      type,
      occurredAt: now,
      providerObjectId: p.providerRef,
      chargeRef: status.chargeRef,
      methodLabel: status.methodLabel,
      raw: { reconciled: true },
    });
    n += 1;
  }
  return n;
}
