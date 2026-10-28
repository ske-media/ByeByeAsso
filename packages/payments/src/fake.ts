import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CheckoutSession,
  ConnectedAccountStatus,
  CreateCheckoutInput,
  PaymentProviderPort,
  ProviderEvent,
} from "@kroov/domain/payments";

/**
 * FAKE provider — development and tests ONLY (refused in staging/production by the factory).
 *
 * It behaves like a hosted provider from the application's point of view:
 * - checkout = redirect to an in-app page `/paiement/{sessionId}` where the tester chooses
 *   « Payer » or « Refuser » (the card is never typed into Kroov, exactly like Stripe Checkout);
 * - that page POSTs a signed webhook (HMAC-SHA256 over the raw body) to
 *   `/api/v1/payments/webhooks/fake`, so signature verification, idempotency, out-of-order and
 *   late deliveries are exercised for real by the test suites;
 * - sessions live in process memory: a `retrievePaymentStatus` after a restart reports `pending`.
 */
export interface FakeSession {
  id: string;
  orderId: string;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  applicationFeeMinor: number;
  customerEmail: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  status: "pending" | "succeeded" | "failed" | "cancelled";
  chargeRef: string | null;
}

export interface FakeProviderOptions {
  appUrl: string;
  webhookSecret: string;
}

export function signFakeWebhook(secret: string, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyFakeSignature(secret: string, rawBody: string, header: string): boolean {
  const expected = signFakeWebhook(secret, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(header ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Build a webhook body the in-app payment page (or a test) sends to the fake endpoint. */
export function buildFakeWebhookBody(input: {
  type:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.cancelled"
    | "refund.succeeded"
    | "refund.failed"
    | "account.updated";
  objectId: string;
  eventId?: string | undefined;
  chargeRef?: string | undefined;
  methodLabel?: string | undefined;
  failureReason?: string | undefined;
  occurredAt?: Date | undefined;
}): string {
  return JSON.stringify({
    id: input.eventId ?? `evt_fake_${randomUUID()}`,
    type: input.type,
    object_id: input.objectId,
    charge_ref: input.chargeRef ?? null,
    method_label: input.methodLabel ?? null,
    failure_reason: input.failureReason ?? null,
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
  });
}

export class FakePaymentProvider implements PaymentProviderPort {
  readonly name = "fake" as const;
  readonly sessions = new Map<string, FakeSession>();
  readonly refunds = new Map<string, { chargeRef: string; amountMinor: number }>();

  constructor(private readonly options: FakeProviderOptions) {}

  async createConnectedAccount(input: { organizationId: string }): Promise<ConnectedAccountStatus> {
    return {
      providerAccountId: `acct_fake_${input.organizationId.slice(0, 8)}`,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    };
  }

  async createOnboardingLink(input: { providerAccountId: string; returnUrl: string }): Promise<string> {
    // No hosted onboarding: the account is active at once; return to the caller's page.
    return `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}fake_account=${encodeURIComponent(input.providerAccountId)}`;
  }

  async retrieveAccountStatus(providerAccountId: string): Promise<ConnectedAccountStatus> {
    return { providerAccountId, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true };
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const id = `cs_fake_${input.idempotencyKey.replaceAll("-", "").slice(0, 24)}`;
    const existing = this.sessions.get(id);
    if (existing) return { providerSessionId: id, redirectUrl: `${this.options.appUrl}/paiement/${id}` };
    this.sessions.set(id, {
      id,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      applicationFeeMinor: input.applicationFee.amountMinor,
      customerEmail: input.customerEmail,
      description: input.description,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      expiresAt: input.expiresAt,
      status: "pending",
      chargeRef: null,
    });
    return { providerSessionId: id, redirectUrl: `${this.options.appUrl}/paiement/${id}` };
  }

  /** Called by the in-app page: settles the session and returns the signed webhook to deliver. */
  settle(
    sessionId: string,
    decision: "succeeded" | "failed",
  ): { body: string; signature: string; session: FakeSession } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session de paiement simulée inconnue.");
    if (session.status === "pending") {
      session.status = decision;
      if (decision === "succeeded") session.chargeRef = `ch_fake_${randomUUID().slice(0, 12)}`;
    }
    const body = buildFakeWebhookBody({
      type: session.status === "succeeded" ? "payment.succeeded" : "payment.failed",
      objectId: session.id,
      chargeRef: session.chargeRef ?? undefined,
      methodLabel: session.status === "succeeded" ? "Carte de démonstration •••• 4242" : undefined,
      failureReason: session.status === "failed" ? "Carte refusée (simulation)" : undefined,
    });
    return { body, signature: signFakeWebhook(this.options.webhookSecret, body), session };
  }

  async verifyWebhook(rawBody: string, signatureHeader: string): Promise<ProviderEvent> {
    if (!verifyFakeSignature(this.options.webhookSecret, rawBody, signatureHeader)) {
      throw new Error("Signature de webhook invalide.");
    }
    const payload = JSON.parse(rawBody) as {
      id: string;
      type: string;
      object_id: string;
      charge_ref: string | null;
      method_label: string | null;
      failure_reason: string | null;
      occurred_at: string;
    };
    const known = [
      "payment.succeeded",
      "payment.failed",
      "payment.cancelled",
      "refund.succeeded",
      "refund.failed",
      "account.updated",
    ];
    return {
      providerEventId: payload.id,
      type: (known.includes(payload.type) ? payload.type : "unknown") as ProviderEvent["type"],
      occurredAt: new Date(payload.occurred_at),
      providerObjectId: payload.object_id,
      chargeRef: payload.charge_ref ?? undefined,
      methodLabel: payload.method_label ?? undefined,
      failureReason: payload.failure_reason ?? undefined,
      raw: payload as unknown as Record<string, unknown>,
    };
  }

  async retrievePaymentStatus(providerSessionId: string) {
    const s = this.sessions.get(providerSessionId);
    if (!s) return { status: "pending" as const };
    return {
      status: s.status,
      chargeRef: s.chargeRef ?? undefined,
      methodLabel: s.status === "succeeded" ? "Carte de démonstration •••• 4242" : undefined,
    };
  }

  async createRefund(input: { chargeRef: string; amount: { amountMinor: number }; idempotencyKey: string }) {
    const id = `re_fake_${input.idempotencyKey.replaceAll("-", "").slice(0, 24)}`;
    this.refunds.set(id, { chargeRef: input.chargeRef, amountMinor: input.amount.amountMinor });
    return { providerRefundId: id, status: "succeeded" as const };
  }
}
