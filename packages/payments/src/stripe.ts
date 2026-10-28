import type {
  CheckoutSession,
  ConnectedAccountStatus,
  CreateCheckoutInput,
  PaymentProviderPort,
  ProviderEvent,
} from "@kroov/domain/payments";
import Stripe from "stripe";

/**
 * Stripe Connect adapter (Express accounts, destination charges on the connected account).
 *
 * - Checkout Session created ON the connected account (`stripeAccount` header) with
 *   `payment_intent_data.application_fee_amount` = platform commission (buyer fees).
 * - Webhooks: `stripe.webhooks.constructEvent` verifies the signature (Connect endpoint:
 *   events of connected accounts carry `account`).
 * - Refunds reverse the transfer and the application fee so the organizer and the platform
 *   each give back their share.
 *
 * External verification is PENDING: no API keys nor network in the validation environment.
 * The mapping below follows the Stripe API reference (2026) and is covered by typing and by a
 * unit test that reconstructs the signature scheme.
 */
export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  /** Hosted onboarding return/refresh URLs are built by the caller. */
  appUrl: string;
}

function methodLabel(pi: Stripe.PaymentIntent | null): string | undefined {
  const pm = pi && typeof pi.payment_method === "object" ? (pi.payment_method as Stripe.PaymentMethod | null) : null;
  if (pm?.card) return `${pm.card.brand.charAt(0).toUpperCase()}${pm.card.brand.slice(1)} •••• ${pm.card.last4}`;
  return undefined;
}

export class StripePaymentProvider implements PaymentProviderPort {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;

  constructor(private readonly options: StripeProviderOptions) {
    this.stripe = new Stripe(options.secretKey, {
      apiVersion: "2026-09-30.clover" as Stripe.LatestApiVersion,
      appInfo: { name: "Kroov" },
    });
  }

  async createConnectedAccount(input: {
    organizationId: string;
    organizationName: string;
    email: string | null;
    country: string;
    idempotencyKey: string;
  }): Promise<ConnectedAccountStatus> {
    const account = await this.stripe.accounts.create(
      {
        type: "express",
        country: input.country,
        ...(input.email ? { email: input.email } : {}),
        business_profile: { name: input.organizationName },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { kroov_organization_id: input.organizationId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      providerAccountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    };
  }

  async createOnboardingLink(input: {
    providerAccountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<string> {
    const link = await this.stripe.accountLinks.create({
      account: input.providerAccountId,
      return_url: input.returnUrl,
      refresh_url: input.refreshUrl,
      type: "account_onboarding",
    });
    return link.url;
  }

  async retrieveAccountStatus(providerAccountId: string): Promise<ConnectedAccountStatus> {
    const account = await this.stripe.accounts.retrieve(providerAccountId);
    return {
      providerAccountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    };
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: input.customerEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.amount.currency.toLowerCase(),
              unit_amount: input.amount.amountMinor,
              product_data: { name: input.description },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: input.applicationFee.amountMinor,
          metadata: { kroov_order_id: input.orderId, kroov_order_number: input.orderNumber },
        },
        metadata: { kroov_order_id: input.orderId },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.max(Math.floor(input.expiresAt.getTime() / 1000), Math.floor(Date.now() / 1000) + 30 * 60),
      },
      { idempotencyKey: input.idempotencyKey, stripeAccount: input.connectedAccountId },
    );
    if (!session.url) throw new Error("Stripe n'a pas renvoyé d'URL de paiement.");
    return { providerSessionId: session.id, redirectUrl: session.url };
  }

  async verifyWebhook(rawBody: string, signatureHeader: string): Promise<ProviderEvent> {
    const event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.options.webhookSecret);
    const base = {
      providerEventId: event.id,
      occurredAt: new Date(event.created * 1000),
      raw: event as unknown as Record<string, unknown>,
    };
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object;
        const pi = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? undefined);
        if (s.payment_status !== "paid") return { ...base, type: "unknown", providerObjectId: s.id };
        return { ...base, type: "payment.succeeded", providerObjectId: s.id, chargeRef: pi };
      }
      case "checkout.session.async_payment_failed": {
        const s = event.data.object;
        return { ...base, type: "payment.failed", providerObjectId: s.id, failureReason: "Paiement différé refusé" };
      }
      case "checkout.session.expired": {
        const s = event.data.object;
        return { ...base, type: "payment.cancelled", providerObjectId: s.id };
      }
      case "charge.refunded": {
        const c = event.data.object;
        const last = c.refunds?.data?.[0];
        return { ...base, type: "refund.succeeded", providerObjectId: last?.id ?? c.id };
      }
      case "refund.failed":
      case "charge.refund.updated": {
        const r = event.data.object as Stripe.Refund;
        return {
          ...base,
          type: r.status === "failed" ? "refund.failed" : r.status === "succeeded" ? "refund.succeeded" : "unknown",
          providerObjectId: r.id,
        };
      }
      case "account.updated": {
        const a = event.data.object;
        return { ...base, type: "account.updated", providerObjectId: a.id };
      }
      default:
        return { ...base, type: "unknown", providerObjectId: event.id };
    }
  }

  async retrievePaymentStatus(providerSessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(providerSessionId, {
      expand: ["payment_intent.payment_method"],
    });
    const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;
    if (session.payment_status === "paid")
      return { status: "succeeded" as const, chargeRef: pi?.id, methodLabel: methodLabel(pi) };
    if (session.status === "expired") return { status: "cancelled" as const };
    if (pi?.status === "canceled") return { status: "failed" as const };
    return { status: "pending" as const };
  }

  async createRefund(input: {
    connectedAccountId: string;
    chargeRef: string;
    amount: { amountMinor: number };
    idempotencyKey: string;
    reason?: string;
  }) {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: input.chargeRef,
        amount: input.amount.amountMinor,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: { kroov_reason: input.reason ?? "" },
      },
      { idempotencyKey: input.idempotencyKey, stripeAccount: input.connectedAccountId },
    );
    return {
      providerRefundId: refund.id,
      status:
        refund.status === "succeeded"
          ? ("succeeded" as const)
          : refund.status === "failed"
            ? ("failed" as const)
            : ("pending" as const),
    };
  }
}

/** Exposed for the unit test that reconstructs Stripe's `t=…,v1=…` signature scheme. */
export function stripeSignatureHeader(
  secret: string,
  payload: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}
