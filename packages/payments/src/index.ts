import type { Money } from "@kroov/domain/kernel";

/**
 * Payment provider port. The Stripe Connect adapter (Phase 3) and the sandbox adapter
 * (tests) both implement this interface. Domain code never imports a provider SDK.
 *
 * Invariants the adapter must respect:
 * - Never report success from a redirect: only `verifyWebhook` + server-side retrieval
 *   are authoritative.
 * - Every call is idempotent on the provided `idempotencyKey`.
 */
export interface CreateCheckoutInput {
  readonly orderId: string;
  readonly organizationPaymentAccountId: string;
  readonly amount: Money;
  readonly platformFee: Money;
  readonly customerEmail: string;
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
  readonly providerObjectId: string;
  readonly raw: unknown;
}

export interface PaymentProviderPort {
  readonly name: string;
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Verify signature and parse; throws on invalid signature. */
  verifyWebhook(rawBody: string, signatureHeader: string): Promise<ProviderEvent>;
  /** Authoritative re-fetch of a payment's state from the provider. */
  retrievePaymentStatus(providerObjectId: string): Promise<"pending" | "succeeded" | "failed" | "cancelled">;
  createRefund(input: {
    providerPaymentId: string;
    amount: Money;
    idempotencyKey: string;
    reason?: string;
  }): Promise<{ providerRefundId: string; status: "pending" | "succeeded" | "failed" }>;
}

/** Phase 0 exposes the contract only. Adapters are delivered in Phase 3. */
export const PAYMENT_PORT_VERSION = 1 as const;
