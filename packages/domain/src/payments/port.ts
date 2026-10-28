import type { Money } from "../kernel";

/**
 * Payment provider port — the ONLY surface the domain knows about a provider.
 * Adapters live in `@kroov/payments` (stripe, fake). Domain code never imports a provider SDK.
 *
 * Invariants every adapter respects:
 * - a redirect never proves anything: only `verifyWebhook` (signature checked) and
 *   `retrievePaymentStatus` (server-side re-fetch) are authoritative;
 * - every call that creates something at the provider carries an idempotency key.
 */
export type PaymentProviderName = "stripe" | "fake";

export interface CreateCheckoutInput {
  readonly orderId: string;
  readonly orderNumber: string;
  /** Provider id of the organization's connected account. */
  readonly connectedAccountId: string;
  readonly amount: Money;
  /** Platform commission collected on the charge (= buyer fees). */
  readonly applicationFee: Money;
  readonly customerEmail: string;
  readonly description: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly expiresAt: Date;
  readonly idempotencyKey: string;
}

export interface CheckoutSession {
  readonly providerSessionId: string;
  readonly redirectUrl: string;
}

export type ProviderEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.cancelled"
  | "refund.succeeded"
  | "refund.failed"
  | "account.updated"
  | "unknown";

export interface ProviderEvent {
  readonly providerEventId: string;
  readonly type: ProviderEventType;
  readonly occurredAt: Date;
  /** Checkout session id for payment.*, refund id for refund.*, account id for account.updated. */
  readonly providerObjectId: string;
  /** Charge / payment-intent reference, when the provider reports it (needed for refunds). */
  readonly chargeRef?: string | undefined;
  /** "Visa •••• 4242" style label, when known. */
  readonly methodLabel?: string | undefined;
  readonly failureReason?: string | undefined;
  readonly raw: Record<string, unknown>;
}

export interface ConnectedAccountStatus {
  readonly providerAccountId: string;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
}

export interface PaymentProviderPort {
  readonly name: PaymentProviderName;
  /** Create the organization's connected account at the provider (Stripe Connect Express). */
  createConnectedAccount(input: {
    organizationId: string;
    organizationName: string;
    email: string | null;
    country: string;
    idempotencyKey: string;
  }): Promise<ConnectedAccountStatus>;
  /** Hosted onboarding link for the connected account. */
  createOnboardingLink(input: { providerAccountId: string; returnUrl: string; refreshUrl: string }): Promise<string>;
  retrieveAccountStatus(providerAccountId: string): Promise<ConnectedAccountStatus>;
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Verify signature and parse; throws on invalid signature. */
  verifyWebhook(rawBody: string, signatureHeader: string): Promise<ProviderEvent>;
  retrievePaymentStatus(providerSessionId: string): Promise<{
    status: "pending" | "succeeded" | "failed" | "cancelled";
    chargeRef?: string | undefined;
    methodLabel?: string | undefined;
  }>;
  createRefund(input: {
    connectedAccountId: string;
    chargeRef: string;
    amount: Money;
    idempotencyKey: string;
    reason?: string;
  }): Promise<{ providerRefundId: string; status: "pending" | "succeeded" | "failed" }>;
}
