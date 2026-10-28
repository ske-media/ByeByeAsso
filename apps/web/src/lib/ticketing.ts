import "server-only";
import type { TicketingContext } from "@kroov/domain/ticketing";
import { createPaymentProvider, type FakePaymentProvider, type PaymentProviderPort } from "@kroov/payments";
import { email } from "./email";
import { env } from "./env";

const g = globalThis as unknown as { __kroovPaymentProvider?: PaymentProviderPort };

/** Process-wide provider singleton (the fake provider keeps its sessions in memory). */
export function paymentProvider(): PaymentProviderPort {
  if (!g.__kroovPaymentProvider) {
    const e = env();
    g.__kroovPaymentProvider = createPaymentProvider({
      provider: e.PAYMENT_PROVIDER,
      appEnv: e.APP_ENV,
      appUrl: e.APP_URL,
      stripeSecretKey: e.STRIPE_SECRET_KEY,
      stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET,
      fakeWebhookSecret: e.FAKE_PAYMENT_WEBHOOK_SECRET,
    });
  }
  return g.__kroovPaymentProvider;
}

/** The fake provider when configured (in-app payment page), null otherwise. */
export function fakeProvider(): FakePaymentProvider | null {
  const p = paymentProvider();
  return p.name === "fake" ? (p as FakePaymentProvider) : null;
}

export function ticketingContext(): TicketingContext {
  const e = env();
  if (!e.AUTH_SECRET) throw new Error("AUTH_SECRET est requis pour dériver les identifiants de billets.");
  return {
    provider: paymentProvider(),
    email: email(),
    appName: e.APP_NAME,
    appUrl: e.APP_URL,
    credentialSecret: e.AUTH_SECRET,
    fees: { bps: e.PLATFORM_FEE_BPS, fixedMinor: e.PLATFORM_FEE_FIXED_MINOR },
  };
}

/** Buyer access token from `?k=` or `Authorization: Bearer`. */
export function buyerTokenFrom(request: Request): string | null {
  const url = new URL(request.url);
  const k = url.searchParams.get("k");
  if (k) return k;
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}
