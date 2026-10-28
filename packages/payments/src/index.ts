import type { PaymentProviderPort } from "@kroov/domain/payments";
import { FakePaymentProvider } from "./fake";
import { StripePaymentProvider } from "./stripe";

export type { PaymentProviderPort } from "@kroov/domain/payments";
export {
  buildFakeWebhookBody,
  FakePaymentProvider,
  type FakeSession,
  signFakeWebhook,
  verifyFakeSignature,
} from "./fake";
export { StripePaymentProvider, stripeSignatureHeader } from "./stripe";

export interface PaymentProviderConfig {
  provider: "stripe" | "fake";
  appEnv: "development" | "test" | "staging" | "production";
  appUrl: string;
  stripeSecretKey?: string | undefined;
  stripeWebhookSecret?: string | undefined;
  fakeWebhookSecret: string;
}

/**
 * Select the provider from configuration. The fake provider is a development/test tool and is
 * refused outside those environments — exactly like the console/file e-mail adapters.
 */
export function createPaymentProvider(config: PaymentProviderConfig): PaymentProviderPort {
  if (config.provider === "fake") {
    if (config.appEnv === "production" || config.appEnv === "staging") {
      throw new Error(`PAYMENT_PROVIDER=fake est interdit en ${config.appEnv}.`);
    }
    return new FakePaymentProvider({ appUrl: config.appUrl, webhookSecret: config.fakeWebhookSecret });
  }
  if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
    throw new Error("PAYMENT_PROVIDER=stripe requiert STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET.");
  }
  return new StripePaymentProvider({
    secretKey: config.stripeSecretKey,
    webhookSecret: config.stripeWebhookSecret,
    appUrl: config.appUrl,
  });
}
