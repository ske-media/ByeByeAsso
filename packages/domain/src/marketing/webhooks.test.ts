import { describe, expect, it } from "vitest";
import { signKroovEmailWebhook, signSvix, verifyEmailWebhook, WebhookVerificationError } from "./webhooks";

describe("email provider webhooks", () => {
  it("verifies the Kroov HMAC signature for the simulated provider and rejects forgeries", () => {
    const body = JSON.stringify({ providerMessageId: "file-1", event: "bounced", hard: true });
    const ok = verifyEmailWebhook(
      "file",
      body,
      { "x-kroov-signature": signKroovEmailWebhook("secret-1234567890", body) },
      "secret-1234567890",
    );
    expect(ok).toEqual([{ providerMessageId: "file-1", event: "bounced", hard: true }]);
    expect(() => verifyEmailWebhook("file", body, { "x-kroov-signature": "v1=00" }, "secret-1234567890")).toThrow(
      WebhookVerificationError,
    );
    expect(() =>
      verifyEmailWebhook(
        "file",
        `${body} `,
        { "x-kroov-signature": signKroovEmailWebhook("secret-1234567890", body) },
        "secret-1234567890",
      ),
    ).toThrow();
  });

  it("verifies Resend (svix) signatures with timestamp tolerance and maps event types", () => {
    const secret = `whsec_${Buffer.from("resend-signing-key").toString("base64")}`;
    const now = new Date("2027-01-01T10:00:00Z");
    const ts = String(Math.floor(now.getTime() / 1000));
    const body = JSON.stringify({
      type: "email.bounced",
      created_at: "2027-01-01T09:59:00Z",
      data: { email_id: "re_1", bounce: { type: "Permanent", message: "550" } },
    });
    const headers = {
      "svix-id": "msg_1",
      "svix-timestamp": ts,
      "svix-signature": `v1,bogus ${signSvix(secret, "msg_1", ts, body)}`,
    };
    const events = verifyEmailWebhook("resend", body, headers, secret, now);
    expect(events).toEqual([
      {
        providerMessageId: "re_1",
        event: "bounced",
        hard: true,
        reason: "550",
        occurredAt: new Date("2027-01-01T09:59:00Z"),
      },
    ]);
    expect(() =>
      verifyEmailWebhook("resend", body, { ...headers, "svix-timestamp": String(Number(ts) - 1000) }, secret, now),
    ).toThrow(/Horodatage/);
    expect(() => verifyEmailWebhook("resend", body, { ...headers, "svix-signature": "v1,nope" }, secret, now)).toThrow(
      /Signature/,
    );
    const soft = JSON.stringify({ type: "email.bounced", data: { email_id: "re_2", bounce: { type: "Transient" } } });
    const ts2 = ts;
    expect(
      verifyEmailWebhook(
        "resend",
        soft,
        { "svix-id": "m2", "svix-timestamp": ts2, "svix-signature": signSvix(secret, "m2", ts2, soft) },
        secret,
        now,
      )[0]?.hard,
    ).toBe(false);
    const other = JSON.stringify({ type: "email.sent", data: { email_id: "re_3" } });
    expect(
      verifyEmailWebhook(
        "resend",
        other,
        { "svix-id": "m3", "svix-timestamp": ts2, "svix-signature": signSvix(secret, "m3", ts2, other) },
        secret,
        now,
      ),
    ).toEqual([]);
  });
});
