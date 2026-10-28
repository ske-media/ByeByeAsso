import { randomUUID } from "node:crypto";
import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { recordTouchpoint } from "../crm";
import {
  type Actor,
  actorLabel,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  newId,
  PreconditionFailedError,
} from "../kernel";
import { emitDomainEvent } from "../outbox";
import { DEFAULT_HOLD_MINUTES, deriveToken, hashToken, type TicketingContext, tokensEqual } from "../ticketing/context";
import { unitFee } from "../ticketing/pricing";
import { paymentStateMachine } from "../ticketing/state-machines";
import {
  sendApplicationReceived,
  sendMembershipActivated,
  sendMembershipApproved,
  sendMembershipExpired,
  sendMembershipRejected,
  sendRenewalReminder,
} from "./emails";
import { listPublicMembershipPlans, loadPlanUnchecked, type MembershipPlanView } from "./plans";
import {
  type ExtendValidityInput,
  extendValiditySchema,
  type ListMembershipsInput,
  listMembershipsSchema,
  type MembershipApplicationInput,
  membershipApplicationSchema,
} from "./schemas";
import {
  computeValidity,
  type MembershipStatus,
  membershipStateMachine,
  RENEWAL_REMINDER_DAYS,
  RENEWAL_WINDOW_AFTER_DAYS,
  RENEWAL_WINDOW_BEFORE_DAYS,
} from "./state-machine";

export const MEMBERSHIP_TOKEN_SCOPE = "membership-access";

/* ------------------------------------------------------------------------- */
/* views                                                                      */
/* ------------------------------------------------------------------------- */

export interface MembershipView {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  number: string;
  status: MembershipStatus;
  plan: { id: string; name: string; slug: string; periodKind: "fixed" | "rolling"; requiresReview: boolean };
  member: { email: string; firstName: string; lastName: string; userId: string | null };
  priceMinor: number;
  feesMinor: number;
  currency: string;
  validFrom: Date | null;
  validUntil: Date | null;
  renewedFrom: string | null;
  renewedBy: string | null;
  activatedAt: Date | null;
  cancellationReason: string | null;
  application: { id: string; status: string; rejectionReason: string | null; reviewedAt: Date | null } | null;
  payment: { id: string; status: string; methodLabel: string | null; amountMinor: number } | null;
  validityChanges: Array<{
    at: Date;
    kind: string;
    newValidFrom: Date | null;
    newValidUntil: Date | null;
    reason: string | null;
    actor: string;
  }>;
  marketingOptIn: boolean;
  version: number;
  createdAt: Date;
}

export interface MemberMembershipView extends MembershipView {
  accessToken: string;
  /** Plans the member may renew into right now (active public plans, renewal window open). */
  renewalPlans: MembershipPlanView[];
}

export interface MembershipListItem {
  id: string;
  number: string;
  status: MembershipStatus;
  memberName: string;
  memberEmail: string;
  planName: string;
  validFrom: Date | null;
  validUntil: Date | null;
  memberSince: Date;
  createdAt: Date;
}

async function loadMembershipUnchecked(
  db: DbExecutor,
  membershipId: string,
  fees: TicketingContext["fees"],
): Promise<MembershipView> {
  const rows = await db
    .select({
      m: schema.memberships,
      plan: schema.membershipPlans,
      org: schema.organizations,
      app: schema.membershipApplications,
    })
    .from(schema.memberships)
    .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.memberships.planId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .leftJoin(schema.membershipApplications, eq(schema.membershipApplications.id, schema.memberships.applicationId))
    .where(eq(schema.memberships.id, membershipId))
    .limit(1);
  const r = rows[0];
  if (!r) throw new NotFoundError("Adhésion", membershipId);
  const payments = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.membershipId, membershipId))
    .orderBy(desc(schema.payments.createdAt));
  const payment = payments.find((p) => p.status === "succeeded") ?? payments[0] ?? null;
  const changes = await db
    .select()
    .from(schema.membershipValidityChanges)
    .where(eq(schema.membershipValidityChanges.membershipId, membershipId))
    .orderBy(asc(schema.membershipValidityChanges.createdAt));
  const renewedBy =
    (
      await db
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(eq(schema.memberships.renewedFrom, membershipId))
        .limit(1)
    )[0]?.id ?? null;
  return {
    id: r.m.id,
    organizationId: r.m.organizationId,
    organizationName: r.org.name,
    organizationSlug: r.org.slug,
    number: r.m.number,
    status: r.m.status,
    plan: {
      id: r.plan.id,
      name: r.plan.name,
      slug: r.plan.slug,
      periodKind: r.plan.periodKind,
      requiresReview: r.plan.requiresReview,
    },
    member: {
      email: r.m.memberEmail,
      firstName: r.m.memberFirstName,
      lastName: r.m.memberLastName,
      userId: r.m.userId,
    },
    priceMinor: r.m.priceMinor,
    feesMinor: unitFee(r.m.priceMinor, fees),
    currency: r.m.currency,
    validFrom: r.m.validFrom,
    validUntil: r.m.validUntil,
    renewedFrom: r.m.renewedFrom,
    renewedBy,
    activatedAt: r.m.activatedAt,
    cancellationReason: r.m.cancellationReason,
    application: r.app
      ? { id: r.app.id, status: r.app.status, rejectionReason: r.app.rejectionReason, reviewedAt: r.app.reviewedAt }
      : null,
    payment: payment
      ? { id: payment.id, status: payment.status, methodLabel: payment.methodLabel, amountMinor: payment.amountMinor }
      : null,
    validityChanges: changes.map((c) => ({
      at: c.createdAt,
      kind: c.kind,
      newValidFrom: c.newValidFrom,
      newValidUntil: c.newValidUntil,
      reason: c.reason,
      actor: c.actorId ? `${c.actorKind}:${c.actorId}` : c.actorKind,
    })),
    marketingOptIn: r.m.marketingOptIn,
    version: r.m.version,
    createdAt: r.m.createdAt,
  };
}

function renewalOpen(m: MembershipView, now: Date): boolean {
  if (!m.validUntil) return false;
  if (m.status === "active" || m.status === "suspended")
    return m.validUntil.getTime() - now.getTime() <= RENEWAL_WINDOW_BEFORE_DAYS * 86_400_000;
  if (m.status === "expired") return now.getTime() - m.validUntil.getTime() <= RENEWAL_WINDOW_AFTER_DAYS * 86_400_000;
  return false;
}

async function withMemberLinks(
  db: DbExecutor,
  ctx: TicketingContext,
  view: MembershipView,
  secretVersion: number,
  now = new Date(),
): Promise<MemberMembershipView> {
  const renewalPlans =
    renewalOpen(view, now) && !view.renewedBy ? await listPublicMembershipPlans(db, view.organizationId) : [];
  return {
    ...view,
    accessToken: deriveToken(ctx.credentialSecret, MEMBERSHIP_TOKEN_SCOPE, view.id, secretVersion),
    renewalPlans: renewalPlans.filter((p) => p.maxMembers === null || p.taken < p.maxMembers),
  };
}

async function recordValidityChange(
  tx: DbExecutor,
  actor: Actor,
  m: typeof schema.memberships.$inferSelect,
  kind: string,
  next: { validFrom: Date | null; validUntil: Date | null },
  reason: string | null,
): Promise<void> {
  await tx.insert(schema.membershipValidityChanges).values({
    organizationId: m.organizationId,
    membershipId: m.id,
    kind,
    previousValidFrom: m.validFrom,
    previousValidUntil: m.validUntil,
    newValidFrom: next.validFrom,
    newValidUntil: next.validUntil,
    reason,
    actorKind: actor.kind,
    actorId:
      actor.kind === "user"
        ? actor.userId
        : actor.kind === "system"
          ? actor.job
          : actor.kind === "webhook"
            ? `${actor.provider}:${actor.eventId}`
            : null,
  });
}

async function lockMembership(tx: DbExecutor, membershipId: string) {
  const rows = await tx
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.id, membershipId))
    .limit(1)
    .for("update");
  const m = rows[0];
  if (!m) throw new NotFoundError("Adhésion", membershipId);
  return m;
}

/* ------------------------------------------------------------------------- */
/* eligibility (used by ticketing)                                            */
/* ------------------------------------------------------------------------- */

/** True when `email` holds an ACTIVE membership of the organization valid at `now`. */
export async function hasActiveMembership(
  db: DbExecutor,
  organizationId: string,
  email: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.memberEmail, email.trim().toLowerCase()),
        eq(schema.memberships.status, "active"),
        sql`${schema.memberships.validFrom} <= ${now} and ${schema.memberships.validUntil} > ${now}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/* ------------------------------------------------------------------------- */
/* activation (shared by free plans, webhooks, approval)                      */
/* ------------------------------------------------------------------------- */

async function activate(
  tx: DbExecutor,
  actor: Actor,
  m: typeof schema.memberships.$inferSelect,
  now: Date,
): Promise<void> {
  const plan = await loadPlanUnchecked(tx, m.organizationId, m.planId);
  const previous = m.renewedFrom
    ? (
        await tx
          .select({ validUntil: schema.memberships.validUntil })
          .from(schema.memberships)
          .where(eq(schema.memberships.id, m.renewedFrom))
          .limit(1)
      )[0]
    : null;
  const validity = computeValidity(plan, now, previous?.validUntil ?? null);
  // One active membership per person and organization (also enforced by partial unique indexes).
  const clash = await tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, m.organizationId),
        eq(schema.memberships.memberEmail, m.memberEmail),
        eq(schema.memberships.status, "active"),
        sql`${schema.memberships.id} <> ${m.id}`,
      ),
    )
    .limit(1);
  if (clash[0]) {
    // A renewal activates after the previous membership: expire the previous one now (validity chained).
    if (m.renewedFrom === clash[0].id) {
      const prev = await lockMembership(tx, clash[0].id);
      membershipStateMachine.transition(prev.status, "expired", { actor: actor.kind });
      await tx
        .update(schema.memberships)
        .set({ status: "expired", expiredAt: now, version: sql`${schema.memberships.version} + 1` })
        .where(eq(schema.memberships.id, prev.id));
      await recordValidityChange(
        tx,
        actor,
        prev,
        "renewed",
        { validFrom: prev.validFrom, validUntil: prev.validUntil },
        `Renouvelée par ${m.number}`,
      );
    } else {
      throw new ConflictError("Cette personne a déjà une adhésion active dans l'organisation.", {
        code: "membership_exists",
      });
    }
  }
  membershipStateMachine.transition(m.status, "active", { actor: actor.kind });
  await tx
    .update(schema.memberships)
    .set({
      status: "active",
      validFrom: validity.validFrom,
      validUntil: validity.validUntil,
      activatedAt: now,
      version: sql`${schema.memberships.version} + 1`,
    })
    .where(eq(schema.memberships.id, m.id));
  await tx
    .insert(schema.membershipEntitlements)
    .values({
      organizationId: m.organizationId,
      membershipId: m.id,
      kind: "member_ticket_eligibility",
      key: "default",
      validFrom: validity.validFrom,
      validUntil: validity.validUntil,
    })
    .onConflictDoNothing();
  await recordValidityChange(tx, actor, m, "activated", validity, null);
  await recordTouchpoint(tx, {
    organizationId: m.organizationId,
    source: "membership",
    sourceId: m.id,
    sourceLabel: `adhésion ${m.number}`,
    email: m.memberEmail,
    firstName: m.memberFirstName,
    lastName: m.memberLastName,
    userId: m.userId,
    occurredAt: now,
    marketingOptIn: m.marketingOptIn,
    customerRelationship: m.priceMinor > 0,
  });
  await recordAudit(tx, actor, {
    organizationId: m.organizationId,
    action: "membership.activated",
    targetType: "membership",
    targetId: m.id,
    metadata: { number: m.number, validFrom: validity.validFrom, validUntil: validity.validUntil },
  });
  await emitDomainEvent(tx, {
    aggregateType: "membership",
    aggregateId: m.id,
    eventType: "membership.activated",
    organizationId: m.organizationId,
    payload: { number: m.number, planId: m.planId },
  });
}

/** Approval path shared by "no review" plans and organizer approval. */
async function approve(
  tx: DbExecutor,
  actor: Actor,
  m: typeof schema.memberships.$inferSelect,
  now: Date,
): Promise<"active" | "awaiting_payment"> {
  if (m.applicationId) {
    await tx
      .update(schema.membershipApplications)
      .set({ status: "approved", reviewedBy: actor.kind === "user" ? actor.userId : null, reviewedAt: now })
      .where(eq(schema.membershipApplications.id, m.applicationId));
  }
  if (m.priceMinor === 0) {
    await activate(tx, actor, m, now);
    return "active";
  }
  membershipStateMachine.transition(m.status, "awaiting_payment", { actor: actor.kind });
  await tx
    .update(schema.memberships)
    .set({ status: "awaiting_payment", version: sql`${schema.memberships.version} + 1` })
    .where(eq(schema.memberships.id, m.id));
  await recordAudit(tx, actor, {
    organizationId: m.organizationId,
    action: "membership.approved",
    targetType: "membership",
    targetId: m.id,
    metadata: { number: m.number },
  });
  return "awaiting_payment";
}

/* ------------------------------------------------------------------------- */
/* public: apply, read, checkout, renew                                       */
/* ------------------------------------------------------------------------- */

async function nextNumber(tx: DbExecutor, organizationId: string): Promise<string> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(eq(schema.memberships.organizationId, organizationId));
  return `M-${String(1 + (rows[0]?.n ?? 0)).padStart(4, "0")}`;
}

/**
 * Public application. Creates the application + a `pending` membership, then approves it at once
 * unless the plan requires review. Free plans become active immediately; paid plans await payment.
 */
export async function applyForMembership(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationSlug: string,
  input: MembershipApplicationInput,
  opts: { renewedFrom?: string | undefined } = {},
  now = new Date(),
): Promise<MemberMembershipView> {
  const v = membershipApplicationSchema.parse(input);
  const result = await db.transaction(async (tx) => {
    const orgRows = await tx
      .select({
        id: schema.organizations.id,
        status: schema.organizations.status,
        currency: schema.organizationSettings.currency,
      })
      .from(schema.organizations)
      .innerJoin(schema.organizationSettings, eq(schema.organizationSettings.organizationId, schema.organizations.id))
      .where(eq(schema.organizations.slug, organizationSlug))
      .limit(1)
      .for("update", { of: schema.organizations });
    const org = orgRows[0];
    if (org?.status !== "active") throw new NotFoundError("Organisation", organizationSlug);
    const plan = await loadPlanUnchecked(tx, org.id, v.planId);
    if (plan.status !== "active" || (!plan.public && !opts.renewedFrom)) throw new NotFoundError("Formule", v.planId);
    if (plan.maxMembers !== null && plan.taken >= plan.maxMembers)
      throw new PreconditionFailedError("Cette formule est complète.", { code: "plan_full" });
    const existing = await tx
      .select({
        id: schema.memberships.id,
        status: schema.memberships.status,
        secretVersion: schema.memberships.secretVersion,
      })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.organizationId, org.id),
          eq(schema.memberships.memberEmail, v.email),
          inArray(schema.memberships.status, ["active", "pending", "awaiting_payment", "suspended"]),
        ),
      );
    const active = existing.find((e) => e.status === "active" || e.status === "suspended");
    if (active && !opts.renewedFrom)
      throw new ConflictError("Une adhésion est déjà active pour cette adresse dans cette organisation.", {
        code: "membership_exists",
        membershipId: active.id,
      });
    const inFlight = existing.find((e) => e.status === "pending" || e.status === "awaiting_payment");
    if (inFlight)
      throw new ConflictError("Une demande est déjà en cours pour cette adresse : consultez l'e-mail reçu.", {
        code: "application_in_progress",
        membershipId: inFlight.id,
      });
    const [application] = await tx
      .insert(schema.membershipApplications)
      .values({
        organizationId: org.id,
        planId: plan.id,
        email: v.email,
        firstName: v.firstName,
        lastName: v.lastName,
        userId: actor.kind === "user" ? actor.userId : null,
        marketingOptIn: v.marketingOptIn ?? false,
      })
      .returning({ id: schema.membershipApplications.id });
    if (!application) throw new Error("application insert failed");
    const id = newId();
    const number = await nextNumber(tx, org.id);
    await tx.insert(schema.memberships).values({
      id,
      organizationId: org.id,
      planId: plan.id,
      applicationId: application.id,
      number,
      memberEmail: v.email,
      memberFirstName: v.firstName,
      memberLastName: v.lastName,
      userId: actor.kind === "user" ? actor.userId : null,
      status: "pending",
      renewedFrom: opts.renewedFrom ?? null,
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      accessTokenHash: hashToken(deriveToken(ctx.credentialSecret, MEMBERSHIP_TOKEN_SCOPE, id, 1)),
      secretVersion: 1,
      marketingOptIn: v.marketingOptIn ?? false,
    });
    await recordAudit(tx, actor, {
      organizationId: org.id,
      action: opts.renewedFrom ? "membership.renewal_requested" : "membership.applied",
      targetType: "membership",
      targetId: id,
      metadata: { number, planId: plan.id, renewedFrom: opts.renewedFrom ?? null },
    });
    let outcome: "pending" | "active" | "awaiting_payment" = "pending";
    if (!plan.requiresReview) {
      const m = await lockMembership(tx, id);
      outcome = await approve(
        tx,
        actor.kind === "user" ? actor : { kind: "system", job: "memberships.auto-approve" },
        m,
        now,
      );
    }
    return { id, outcome };
  });
  const view = await withMemberLinks(db, ctx, await loadMembershipUnchecked(db, result.id, ctx.fees), 1, now);
  if (result.outcome === "pending") await sendApplicationReceived(ctx, view).catch(() => undefined);
  else if (result.outcome === "active") await sendMembershipActivated(ctx, view).catch(() => undefined);
  else await sendMembershipApproved(ctx, view).catch(() => undefined);
  return view;
}

export async function getMembershipForMember(
  db: DbExecutor,
  ctx: TicketingContext,
  membershipId: string,
  auth: { accessToken?: string | null | undefined; actor?: Actor | undefined; email?: string | undefined },
  now = new Date(),
): Promise<MemberMembershipView> {
  const rows = await db
    .select({
      hash: schema.memberships.accessTokenHash,
      v: schema.memberships.secretVersion,
      userId: schema.memberships.userId,
      email: schema.memberships.memberEmail,
    })
    .from(schema.memberships)
    .where(eq(schema.memberships.id, membershipId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Adhésion", membershipId);
  const byToken = auth.accessToken ? tokensEqual(hashToken(auth.accessToken), row.hash) : false;
  const byUser =
    auth.actor?.kind === "user" &&
    ((row.userId !== null && row.userId === auth.actor.userId) ||
      (auth.email !== undefined && auth.email.toLowerCase() === row.email));
  if (!byToken && !byUser) throw new NotFoundError("Adhésion", membershipId);
  return withMemberLinks(db, ctx, await loadMembershipUnchecked(db, membershipId, ctx.fees), row.v, now);
}

export type MembershipCheckoutResult = { kind: "active" } | { kind: "redirect"; url: string; paymentId: string };

/** Start the cotisation payment (hosted provider page). Activation happens on the webhook only. */
export async function startMembershipCheckout(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  membershipId: string,
  accessToken: string,
  urls: { successUrl: string; cancelUrl: string },
  now = new Date(),
): Promise<MembershipCheckoutResult> {
  await getMembershipForMember(db, ctx, membershipId, { accessToken, actor });
  return db.transaction(async (tx): Promise<MembershipCheckoutResult> => {
    const m = await lockMembership(tx, membershipId);
    if (m.status === "active") return { kind: "active" };
    if (m.status !== "awaiting_payment")
      throw new PreconditionFailedError("Cette adhésion n'attend pas de paiement.", {
        code: "not_awaiting_payment",
        status: m.status,
      });
    const account = (
      await tx
        .select()
        .from(schema.paymentAccounts)
        .where(
          and(
            eq(schema.paymentAccounts.organizationId, m.organizationId),
            eq(schema.paymentAccounts.provider, ctx.provider.name),
          ),
        )
        .limit(1)
    )[0];
    if (!account?.chargesEnabled || account.status !== "active") {
      throw new PreconditionFailedError("Le paiement en ligne n'est pas encore disponible pour cette organisation.", {
        code: "payment_account_unavailable",
      });
    }
    const fee = unitFee(m.priceMinor, ctx.fees);
    const total = m.priceMinor + fee;
    const paymentId = newId();
    await tx.insert(schema.payments).values({
      id: paymentId,
      organizationId: m.organizationId,
      membershipId,
      provider: ctx.provider.name,
      providerRef: `pending:${paymentId}`,
      status: "created",
      amountMinor: total,
      applicationFeeMinor: fee,
      currency: m.currency,
    });
    const plan = await loadPlanUnchecked(tx, m.organizationId, m.planId);
    const session = await ctx.provider.createCheckoutSession({
      orderId: membershipId,
      orderNumber: m.number,
      connectedAccountId: account.providerAccountId,
      amount: { amountMinor: total, currency: m.currency as "EUR" | "CHF" },
      applicationFee: { amountMinor: fee, currency: m.currency as "EUR" | "CHF" },
      customerEmail: m.memberEmail,
      description: `Adhésion ${plan.name} · ${m.number}`,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
      expiresAt: new Date(now.getTime() + Math.max(DEFAULT_HOLD_MINUTES, 30) * 60_000),
      idempotencyKey: paymentId,
    });
    paymentStateMachine.transition("created", "pending", { actor: actor.kind });
    await tx
      .update(schema.payments)
      .set({ providerRef: session.providerSessionId, status: "pending" })
      .where(eq(schema.payments.id, paymentId));
    await recordAudit(tx, actor, {
      organizationId: m.organizationId,
      action: "membership.checkout_started",
      targetType: "membership",
      targetId: membershipId,
      metadata: { paymentId },
    });
    return { kind: "redirect", url: session.redirectUrl, paymentId };
  });
}

/** Webhook path (payment row + membership locked by the caller through `lockMembership`). */
export async function activateMembershipFromPayment(
  tx: DbExecutor,
  actor: Actor,
  membershipId: string,
  now: Date,
): Promise<"applied" | "duplicate"> {
  const m = await lockMembership(tx, membershipId);
  if (m.status === "active") return "duplicate";
  if (m.status !== "awaiting_payment" && m.status !== "pending") {
    throw new PreconditionFailedError("Paiement reçu pour une adhésion qui ne l'attend plus.", {
      code: "membership_not_payable",
      status: m.status,
    });
  }
  await activate(tx, actor, m, now);
  return "applied";
}

export async function notifyMembershipActivated(
  db: DbExecutor,
  ctx: TicketingContext,
  membershipId: string,
): Promise<void> {
  const row = (
    await db
      .select({ v: schema.memberships.secretVersion })
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membershipId))
      .limit(1)
  )[0];
  const view = await withMemberLinks(db, ctx, await loadMembershipUnchecked(db, membershipId, ctx.fees), row?.v ?? 1);
  await sendMembershipActivated(ctx, view).catch(() => undefined);
}

/** Member-initiated renewal into `planId`: a new linked membership (same approval rules). */
export async function renewMembership(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  membershipId: string,
  accessToken: string,
  planId: string,
  now = new Date(),
): Promise<MemberMembershipView> {
  const current = await getMembershipForMember(db, ctx, membershipId, { accessToken, actor }, now);
  if (!renewalOpen(current, now))
    throw new PreconditionFailedError("Le renouvellement n'est pas encore ouvert pour cette adhésion.", {
      code: "renewal_closed",
    });
  if (current.renewedBy)
    throw new PreconditionFailedError("Cette adhésion a déjà été renouvelée.", { code: "already_renewed" });
  if (!current.renewalPlans.some((p) => p.id === planId)) throw new NotFoundError("Formule", planId);
  return applyForMembership(
    db,
    ctx,
    actor,
    current.organizationSlug,
    {
      planId,
      email: current.member.email,
      firstName: current.member.firstName,
      lastName: current.member.lastName,
      marketingOptIn: current.marketingOptIn,
    },
    { renewedFrom: membershipId },
    now,
  );
}

/* ------------------------------------------------------------------------- */
/* organizer                                                                  */
/* ------------------------------------------------------------------------- */

export async function listMemberships(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  input: ListMembershipsInput = {},
): Promise<MembershipListItem[]> {
  const v = listMembershipsSchema.parse(input);
  await requirePermission(db, actor, "memberships.manage", { organizationId });
  const now = new Date();
  const conditions = [eq(schema.memberships.organizationId, organizationId)];
  if (v.planId) conditions.push(eq(schema.memberships.planId, v.planId));
  if (v.status === "to_renew") {
    conditions.push(
      or(
        and(
          eq(schema.memberships.status, "active"),
          sql`${schema.memberships.validUntil} <= ${new Date(now.getTime() + RENEWAL_WINDOW_BEFORE_DAYS * 86_400_000)}`,
        ),
        and(
          eq(schema.memberships.status, "expired"),
          sql`${schema.memberships.validUntil} >= ${new Date(now.getTime() - RENEWAL_WINDOW_AFTER_DAYS * 86_400_000)}`,
        ),
      ) ?? sql`true`,
    );
    conditions.push(
      sql`not exists (select 1 from ${schema.memberships} r where r.renewed_from = ${schema.memberships.id})`,
    );
  } else if (v.status !== "all") conditions.push(eq(schema.memberships.status, v.status));
  if (v.q) {
    const q = `%${v.q}%`;
    conditions.push(
      or(
        ilike(schema.memberships.number, q),
        ilike(schema.memberships.memberEmail, q),
        ilike(schema.memberships.memberFirstName, q),
        ilike(schema.memberships.memberLastName, q),
      ) ?? sql`true`,
    );
  }
  const rows = await db
    .select({
      m: schema.memberships,
      planName: schema.membershipPlans.name,
      memberSince: sql<Date>`(select min(x.created_at) from ${schema.memberships} x where x.organization_id = "memberships"."organization_id" and x.member_email = "memberships"."member_email" and x.status in ('active','expired','suspended'))`,
    })
    .from(schema.memberships)
    .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.memberships.planId))
    .where(and(...conditions))
    .orderBy(desc(schema.memberships.createdAt))
    .limit(1000);
  return rows.map((r) => ({
    id: r.m.id,
    number: r.m.number,
    status: r.m.status,
    memberName: `${r.m.memberFirstName} ${r.m.memberLastName}`.trim(),
    memberEmail: r.m.memberEmail,
    planName: r.planName,
    validFrom: r.m.validFrom,
    validUntil: r.m.validUntil,
    memberSince: r.memberSince ? new Date(r.memberSince) : r.m.createdAt,
    createdAt: r.m.createdAt,
  }));
}

export interface MembershipStats {
  active: number;
  toRenew: number;
  pending: number;
  duesMinor: number;
  currency: string;
}

export async function membershipStats(db: DbExecutor, actor: Actor, organizationId: string): Promise<MembershipStats> {
  await requirePermission(db, actor, "memberships.manage", { organizationId });
  const now = new Date();
  const [r] = await db
    .select({
      active: sql<number>`count(*) filter (where ${schema.memberships.status} = 'active')::int`,
      pending: sql<number>`count(*) filter (where ${schema.memberships.status} in ('pending','awaiting_payment'))::int`,
      toRenew: sql<number>`count(*) filter (where (${schema.memberships.status} = 'active' and ${schema.memberships.validUntil} <= ${new Date(now.getTime() + RENEWAL_WINDOW_BEFORE_DAYS * 86_400_000)}) or (${schema.memberships.status} = 'expired' and ${schema.memberships.validUntil} >= ${new Date(now.getTime() - RENEWAL_WINDOW_AFTER_DAYS * 86_400_000)}))::int`,
      dues: sql<number>`coalesce(sum(${schema.memberships.priceMinor}) filter (where ${schema.memberships.status} in ('active','expired','suspended') and ${schema.memberships.activatedAt} is not null), 0)::int`,
    })
    .from(schema.memberships)
    .where(eq(schema.memberships.organizationId, organizationId));
  const cur =
    (
      await db
        .select({ c: schema.organizationSettings.currency })
        .from(schema.organizationSettings)
        .where(eq(schema.organizationSettings.organizationId, organizationId))
        .limit(1)
    )[0]?.c ?? "EUR";
  return {
    active: r?.active ?? 0,
    toRenew: r?.toRenew ?? 0,
    pending: r?.pending ?? 0,
    duesMinor: r?.dues ?? 0,
    currency: cur,
  };
}

export async function getMembership(
  db: DbExecutor,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  membershipId: string,
): Promise<MembershipView> {
  await requirePermission(db, actor, "memberships.manage", { organizationId });
  const row = (
    await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, organizationId)))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("Adhésion", membershipId);
  return loadMembershipUnchecked(db, membershipId, ctx.fees);
}

async function organizerAction<T>(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  membershipId: string,
  fn: (tx: DbExecutor, m: typeof schema.memberships.$inferSelect, now: Date) => Promise<T>,
): Promise<{ result: T; view: MemberMembershipView }> {
  await requirePermission(db, actor, "memberships.manage", { organizationId });
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const m = await lockMembership(tx, membershipId);
    if (m.organizationId !== organizationId) throw new NotFoundError("Adhésion", membershipId);
    return fn(tx, m, now);
  });
  const row = (
    await db
      .select({ v: schema.memberships.secretVersion })
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membershipId))
      .limit(1)
  )[0];
  const view = await withMemberLinks(
    db,
    ctx,
    await loadMembershipUnchecked(db, membershipId, ctx.fees),
    row?.v ?? 1,
    now,
  );
  return { result, view };
}

export async function approveMembership(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  membershipId: string,
): Promise<MembershipView> {
  const { result, view } = await organizerAction(db, ctx, actor, organizationId, membershipId, async (tx, m, now) => {
    if (m.status !== "pending")
      throw new PreconditionFailedError("Seule une demande en attente peut être approuvée.", { code: "not_pending" });
    return approve(tx, actor, m, now);
  });
  if (result === "active") await sendMembershipActivated(ctx, view).catch(() => undefined);
  else await sendMembershipApproved(ctx, view).catch(() => undefined);
  return view;
}

export async function rejectMembership(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  membershipId: string,
  reason: string,
): Promise<MembershipView> {
  const { view } = await organizerAction(db, ctx, actor, organizationId, membershipId, async (tx, m, now) => {
    membershipStateMachine.transition(m.status, "rejected", { actor: actor.kind });
    await tx
      .update(schema.memberships)
      .set({ status: "rejected", version: sql`${schema.memberships.version} + 1` })
      .where(eq(schema.memberships.id, m.id));
    if (m.applicationId)
      await tx
        .update(schema.membershipApplications)
        .set({
          status: "rejected",
          rejectionReason: reason,
          reviewedBy: actor.kind === "user" ? actor.userId : null,
          reviewedAt: now,
        })
        .where(eq(schema.membershipApplications.id, m.applicationId));
    await recordAudit(tx, actor, {
      organizationId,
      action: "membership.rejected",
      targetType: "membership",
      targetId: m.id,
      reason,
      metadata: { number: m.number },
    });
  });
  await sendMembershipRejected(ctx, view, reason).catch(() => undefined);
  return view;
}

export async function suspendMembership(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  membershipId: string,
  reason: string,
): Promise<MembershipView> {
  return (
    await organizerAction(db, ctx, actor, organizationId, membershipId, async (tx, m) => {
      membershipStateMachine.transition(m.status, "suspended", { actor: actor.kind });
      await tx
        .update(schema.memberships)
        .set({ status: "suspended", suspendedAt: new Date(), version: sql`${schema.memberships.version} + 1` })
        .where(eq(schema.memberships.id, m.id));
      await recordValidityChange(
        tx,
        actor,
        m,
        "suspended",
        { validFrom: m.validFrom, validUntil: m.validUntil },
        reason,
      );
      await recordAudit(tx, actor, {
        organizationId,
        action: "membership.suspended",
        targetType: "membership",
        targetId: m.id,
        reason,
        metadata: { number: m.number },
      });
    })
  ).view;
}

export async function reactivateMembership(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  membershipId: string,
): Promise<MembershipView> {
  return (
    await organizerAction(db, ctx, actor, organizationId, membershipId, async (tx, m, now) => {
      membershipStateMachine.transition(m.status, "active", { actor: actor.kind });
      if (m.validUntil && m.validUntil.getTime() <= now.getTime())
        throw new PreconditionFailedError("La validité est dépassée : prolongez-la ou proposez un renouvellement.", {
          code: "validity_over",
        });
      await tx
        .update(schema.memberships)
        .set({ status: "active", suspendedAt: null, version: sql`${schema.memberships.version} + 1` })
        .where(eq(schema.memberships.id, m.id));
      await recordValidityChange(
        tx,
        actor,
        m,
        "reactivated",
        { validFrom: m.validFrom, validUntil: m.validUntil },
        null,
      );
      await recordAudit(tx, actor, {
        organizationId,
        action: "membership.reactivated",
        targetType: "membership",
        targetId: m.id,
        metadata: { number: m.number },
      });
    })
  ).view;
}

export async function cancelMembership(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  membershipId: string,
  reason: string,
): Promise<MembershipView> {
  return (
    await organizerAction(db, ctx, actor, organizationId, membershipId, async (tx, m, now) => {
      membershipStateMachine.transition(m.status, "cancelled", { actor: actor.kind });
      await tx
        .update(schema.memberships)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancellationReason: reason,
          version: sql`${schema.memberships.version} + 1`,
        })
        .where(eq(schema.memberships.id, m.id));
      if (m.applicationId && (m.status === "pending" || m.status === "awaiting_payment")) {
        await tx
          .update(schema.membershipApplications)
          .set({ status: "withdrawn" })
          .where(eq(schema.membershipApplications.id, m.applicationId));
      }
      await recordValidityChange(tx, actor, m, "cancelled", { validFrom: m.validFrom, validUntil: now }, reason);
      await recordAudit(tx, actor, {
        organizationId,
        action: "membership.cancelled",
        targetType: "membership",
        targetId: m.id,
        reason,
        metadata: { number: m.number },
      });
      await emitDomainEvent(tx, {
        aggregateType: "membership",
        aggregateId: m.id,
        eventType: "membership.cancelled",
        organizationId,
        payload: { number: m.number },
      });
    })
  ).view;
}

/** Extend validity (reason mandatory): auditable, append-only history. */
export async function extendMembership(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  membershipId: string,
  input: ExtendValidityInput,
): Promise<MembershipView> {
  const v = extendValiditySchema.parse(input);
  return (
    await organizerAction(db, ctx, actor, organizationId, membershipId, async (tx, m) => {
      if (m.status !== "active" && m.status !== "suspended")
        throw new PreconditionFailedError("Seule une adhésion active ou suspendue peut être prolongée.", {
          code: "not_extendable",
        });
      if (!m.validUntil || v.validUntil.getTime() <= m.validUntil.getTime())
        throw new PreconditionFailedError("La nouvelle fin doit être postérieure à la fin actuelle.", {
          code: "not_later",
          field: "validUntil",
        });
      await tx
        .update(schema.memberships)
        .set({ validUntil: v.validUntil, version: sql`${schema.memberships.version} + 1` })
        .where(eq(schema.memberships.id, m.id));
      await tx
        .update(schema.membershipEntitlements)
        .set({ validUntil: v.validUntil })
        .where(eq(schema.membershipEntitlements.membershipId, m.id));
      await recordValidityChange(
        tx,
        actor,
        m,
        "extended",
        { validFrom: m.validFrom, validUntil: v.validUntil },
        v.reason,
      );
      await recordAudit(tx, actor, {
        organizationId,
        action: "membership.extended",
        targetType: "membership",
        targetId: m.id,
        reason: v.reason,
        metadata: { number: m.number, validUntil: v.validUntil },
      });
    })
  ).view;
}

/** Rotate the member link and send the card again. */
export async function resendMembershipLink(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  const { view, result } = await organizerAction(db, ctx, actor, organizationId, membershipId, async (tx, m) => {
    const next = m.secretVersion + 1;
    await tx
      .update(schema.memberships)
      .set({
        secretVersion: next,
        accessTokenHash: hashToken(deriveToken(ctx.credentialSecret, MEMBERSHIP_TOKEN_SCOPE, m.id, next)),
      })
      .where(eq(schema.memberships.id, m.id));
    await recordAudit(tx, actor, {
      organizationId,
      action: "membership.link_resent",
      targetType: "membership",
      targetId: m.id,
      metadata: { number: m.number },
    });
    return m.status;
  });
  if (result === "active" || result === "suspended" || result === "expired") await sendMembershipActivated(ctx, view);
  else if (result === "awaiting_payment") await sendMembershipApproved(ctx, view);
  else await sendApplicationReceived(ctx, view);
}

/* ------------------------------------------------------------------------- */
/* member side (signed-in)                                                    */
/* ------------------------------------------------------------------------- */

export async function listMyMemberships(
  db: DbExecutor,
  ctx: TicketingContext,
  actor: Actor,
  email: string,
): Promise<MemberMembershipView[]> {
  if (actor.kind !== "user") throw new ForbiddenError("user");
  const rows = await db
    .select({ id: schema.memberships.id, v: schema.memberships.secretVersion })
    .from(schema.memberships)
    .where(or(eq(schema.memberships.userId, actor.userId), eq(schema.memberships.memberEmail, email.toLowerCase())))
    .orderBy(desc(schema.memberships.createdAt))
    .limit(50);
  const out: MemberMembershipView[] = [];
  for (const r of rows)
    out.push(await withMemberLinks(db, ctx, await loadMembershipUnchecked(db, r.id, ctx.fees), r.v));
  return out;
}

/* ------------------------------------------------------------------------- */
/* jobs                                                                       */
/* ------------------------------------------------------------------------- */

/** Expire active/suspended memberships past their validity (daily). */
export async function expireMemberships(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  now = new Date(),
): Promise<number> {
  if (actor.kind !== "system") throw new ForbiddenError("system");
  const due = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(inArray(schema.memberships.status, ["active", "suspended"]), sql`${schema.memberships.validUntil} <= ${now}`),
    )
    .limit(500);
  let n = 0;
  for (const d of due) {
    const expired = await db.transaction(async (tx) => {
      const m = await lockMembership(tx, d.id);
      if (
        (m.status !== "active" && m.status !== "suspended") ||
        !m.validUntil ||
        m.validUntil.getTime() > now.getTime()
      )
        return false;
      membershipStateMachine.transition(m.status, "expired", { actor: "system" });
      await tx
        .update(schema.memberships)
        .set({ status: "expired", expiredAt: now, version: sql`${schema.memberships.version} + 1` })
        .where(eq(schema.memberships.id, m.id));
      await recordValidityChange(tx, actor, m, "expired", { validFrom: m.validFrom, validUntil: m.validUntil }, null);
      await recordAudit(tx, actor, {
        organizationId: m.organizationId,
        action: "membership.expired",
        targetType: "membership",
        targetId: m.id,
        metadata: { number: m.number },
      });
      await emitDomainEvent(tx, {
        aggregateType: "membership",
        aggregateId: m.id,
        eventType: "membership.expired",
        organizationId: m.organizationId,
        payload: { number: m.number },
      });
      return true;
    });
    if (expired) {
      n += 1;
      const row = (
        await db
          .select({ v: schema.memberships.secretVersion })
          .from(schema.memberships)
          .where(eq(schema.memberships.id, d.id))
          .limit(1)
      )[0];
      await sendMembershipExpired(
        ctx,
        await withMemberLinks(db, ctx, await loadMembershipUnchecked(db, d.id, ctx.fees), row?.v ?? 1, now),
      ).catch(() => undefined);
    }
  }
  return n;
}

/** Renewal reminder, once, RENEWAL_REMINDER_DAYS before expiry, only when a public plan exists. */
export async function sendRenewalReminders(
  db: Database,
  ctx: TicketingContext,
  actor: Actor,
  now = new Date(),
): Promise<number> {
  if (actor.kind !== "system") throw new ForbiddenError("system");
  const horizon = new Date(now.getTime() + RENEWAL_REMINDER_DAYS * 86_400_000);
  const due = await db
    .select({
      id: schema.memberships.id,
      organizationId: schema.memberships.organizationId,
      v: schema.memberships.secretVersion,
    })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.status, "active"),
        sql`${schema.memberships.reminderSentAt} is null`,
        sql`${schema.memberships.validUntil} <= ${horizon} and ${schema.memberships.validUntil} > ${now}`,
      ),
    )
    .limit(500);
  let n = 0;
  for (const d of due) {
    const plans = await listPublicMembershipPlans(db, d.organizationId);
    if (plans.length === 0) continue;
    const view = await withMemberLinks(db, ctx, await loadMembershipUnchecked(db, d.id, ctx.fees), d.v, now);
    if (view.renewedBy) continue;
    await sendRenewalReminder(ctx, view);
    await db.update(schema.memberships).set({ reminderSentAt: now }).where(eq(schema.memberships.id, d.id));
    await recordAudit(db, actor, {
      organizationId: d.organizationId,
      action: "membership.reminder_sent",
      targetType: "membership",
      targetId: d.id,
    });
    n += 1;
  }
  return n;
}

export { actorLabel };

/** Account deletion (phase 10): memberships of the person lose their identity; links are revoked. */
export async function anonymiseMemberships(
  db: DbExecutor,
  target: { userId: string; email: string; replacementEmail: string },
): Promise<number> {
  const rows = await db
    .update(schema.memberships)
    .set({
      memberFirstName: "Compte",
      memberLastName: "supprimé",
      memberEmail: target.replacementEmail,
      userId: null,
      secretVersion: sql`${schema.memberships.secretVersion} + 1`,
      // Revocation without the signing secret: a hash nobody can reproduce.
      accessTokenHash: hashToken(`revoked:${randomUUID()}`),
      updatedAt: new Date(),
    })
    .where(or(eq(schema.memberships.userId, target.userId), eq(schema.memberships.memberEmail, target.email)))
    .returning({ id: schema.memberships.id });
  return rows.length;
}
