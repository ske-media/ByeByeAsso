import { describe, expect, it } from "vitest";
import { buildFakeWebhookBody, FakePaymentProvider, signFakeWebhook } from "./fake";
import { createPaymentProvider } from "./index";
import { StripePaymentProvider, stripeSignatureHeader } from "./stripe";

describe("payment providers", () => {
  it("refuses the fake provider in staging and production", () => {
    for (const appEnv of ["staging", "production"] as const) {
      expect(() =>
        createPaymentProvider({
          provider: "fake",
          appEnv,
          appUrl: "https://kroov.app",
          fakeWebhookSecret: "x".repeat(16),
        }),
      ).toThrow(/interdit/);
    }
    expect(
      createPaymentProvider({
        provider: "fake",
        appEnv: "test",
        appUrl: "http://localhost:3000",
        fakeWebhookSecret: "x".repeat(16),
      }).name,
    ).toBe("fake");
    expect(() =>
      createPaymentProvider({
        provider: "stripe",
        appEnv: "production",
        appUrl: "https://kroov.app",
        fakeWebhookSecret: "x",
      }),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("fake provider: signature is verified in constant time and tampering is rejected", async () => {
    const p = new FakePaymentProvider({ appUrl: "http://localhost:3000", webhookSecret: "secret-0123456789" });
    const body = buildFakeWebhookBody({
      type: "payment.succeeded",
      objectId: "cs_fake_1",
      eventId: "evt_1",
      chargeRef: "ch_1",
    });
    const ok = await p.verifyWebhook(body, signFakeWebhook("secret-0123456789", body));
    expect(ok).toMatchObject({
      providerEventId: "evt_1",
      type: "payment.succeeded",
      providerObjectId: "cs_fake_1",
      chargeRef: "ch_1",
    });
    await expect(
      p.verifyWebhook(body.replace("cs_fake_1", "cs_fake_2"), signFakeWebhook("secret-0123456789", body)),
    ).rejects.toThrow(/Signature/);
    await expect(p.verifyWebhook(body, signFakeWebhook("other-secret", body))).rejects.toThrow(/Signature/);
    const session = await p.createCheckoutSession({
      orderId: "o1",
      orderNumber: "KR-1000",
      connectedAccountId: "acct",
      amount: { amountMinor: 6240, currency: "EUR" },
      applicationFee: { amountMinor: 240, currency: "EUR" },
      customerEmail: "a@b.fr",
      description: "Test",
      successUrl: "http://localhost:3000/ok",
      cancelUrl: "http://localhost:3000/ko",
      expiresAt: new Date(Date.now() + 600_000),
      idempotencyKey: "11111111-2222-3333-4444-555555555555",
    });
    const again = await p.createCheckoutSession({
      orderId: "o1",
      orderNumber: "KR-1000",
      connectedAccountId: "acct",
      amount: { amountMinor: 6240, currency: "EUR" },
      applicationFee: { amountMinor: 240, currency: "EUR" },
      customerEmail: "a@b.fr",
      description: "Test",
      successUrl: "x",
      cancelUrl: "y",
      expiresAt: new Date(),
      idempotencyKey: "11111111-2222-3333-4444-555555555555",
    });
    expect(again.providerSessionId).toBe(session.providerSessionId); // idempotent on the key
    const settled = p.settle(session.providerSessionId, "succeeded");
    expect(settled.session.status).toBe("succeeded");
    expect((await p.verifyWebhook(settled.body, settled.signature)).type).toBe("payment.succeeded");
    expect(p.settle(session.providerSessionId, "failed").session.status).toBe("succeeded"); // a settled session never flips
  });

  it("stripe adapter: verifies the t=…,v1=… signature scheme and maps checkout events (no network)", async () => {
    const p = new StripePaymentProvider({
      secretKey: "sk_test_placeholder",
      webhookSecret: "whsec_test_secret",
      appUrl: "http://localhost:3000",
    });
    const payload = JSON.stringify({
      id: "evt_test_1",
      object: "event",
      created: 1_800_000_000,
      type: "checkout.session.completed",
      data: {
        object: { id: "cs_test_1", object: "checkout.session", payment_status: "paid", payment_intent: "pi_test_1" },
      },
    });
    const event = await p.verifyWebhook(payload, stripeSignatureHeader("whsec_test_secret", payload));
    expect(event).toMatchObject({
      providerEventId: "evt_test_1",
      type: "payment.succeeded",
      providerObjectId: "cs_test_1",
      chargeRef: "pi_test_1",
    });
    await expect(p.verifyWebhook(payload, stripeSignatureHeader("whsec_wrong", payload))).rejects.toThrow();
    // A stale timestamp (default tolerance 300 s) is rejected: replay protection.
    await expect(
      p.verifyWebhook(payload, stripeSignatureHeader("whsec_test_secret", payload, 1_600_000_000)),
    ).rejects.toThrow(/timestamp/i);
    const expired = JSON.stringify({
      id: "evt_test_2",
      object: "event",
      created: 1_800_000_000,
      type: "checkout.session.expired",
      data: { object: { id: "cs_test_2", object: "checkout.session" } },
    });
    expect((await p.verifyWebhook(expired, stripeSignatureHeader("whsec_test_secret", expired))).type).toBe(
      "payment.cancelled",
    );
  });
});
