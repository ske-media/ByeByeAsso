import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeliveryCallback } from "./schemas";

/**
 * Provider delivery callbacks → normalised `DeliveryCallback`s. The signature over the RAW body
 * authenticates the call; a bad signature is a verification error (400 at the route).
 * - `resend`: svix-style headers (`svix-id`, `svix-timestamp`, `svix-signature`), secret `whsec_<base64>`.
 * - any other configured port (file / console / smtp in tests): Kroov HMAC `x-kroov-signature: v1=<hex>`.
 */

export class WebhookVerificationError extends Error {}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function signKroovEmailWebhook(secret: string, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function signSvix(secret: string, id: string, timestamp: string, rawBody: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64")}`;
}

const RESEND_EVENTS: Record<string, DeliveryCallback["event"] | undefined> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

export function verifyEmailWebhook(
  provider: string,
  rawBody: string,
  headers: Record<string, string | null | undefined>,
  secret: string,
  now = new Date(),
): DeliveryCallback[] {
  if (provider === "resend") {
    const id = headers["svix-id"] ?? "";
    const timestamp = headers["svix-timestamp"] ?? "";
    const signature = headers["svix-signature"] ?? "";
    if (!id || !timestamp || !signature) throw new WebhookVerificationError("En-têtes de signature absents.");
    const age = Math.abs(now.getTime() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 300) throw new WebhookVerificationError("Horodatage hors tolérance.");
    const expected = signSvix(secret, id, timestamp, rawBody);
    const ok = signature.split(" ").some((candidate) => safeEqual(candidate, expected));
    if (!ok) throw new WebhookVerificationError("Signature invalide.");
    const payload = JSON.parse(rawBody) as {
      type?: string;
      created_at?: string;
      data?: { email_id?: string; bounce?: { type?: string; message?: string } };
    };
    const event = RESEND_EVENTS[payload.type ?? ""];
    if (!event || !payload.data?.email_id) return [];
    return [
      {
        providerMessageId: payload.data.email_id,
        event,
        hard: event !== "bounced" || (payload.data.bounce?.type ?? "Permanent").toLowerCase() !== "transient",
        reason: payload.data.bounce?.message,
        occurredAt: payload.created_at ? new Date(payload.created_at) : now,
      },
    ];
  }
  const header = headers["x-kroov-signature"] ?? "";
  if (!safeEqual(signKroovEmailWebhook(secret, rawBody), header))
    throw new WebhookVerificationError("Signature invalide.");
  const payload = JSON.parse(rawBody) as { events?: DeliveryCallback[] } | DeliveryCallback;
  const list = Array.isArray((payload as { events?: unknown }).events)
    ? ((payload as { events: DeliveryCallback[] }).events ?? [])
    : [payload as DeliveryCallback];
  return list;
}
