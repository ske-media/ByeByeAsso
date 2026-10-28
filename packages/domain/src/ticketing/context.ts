import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { EmailPort } from "@kroov/notifications";
import type { PaymentProviderPort } from "../payments/port";

/**
 * Dependencies of the ticketing services, wired by the app (web / worker / tests).
 * Secrets never live in the domain: `credentialSecret` is the server key used to derive
 * buyer links, ticket links and QR credentials (HMAC), none of which is stored in clear.
 */
export interface TicketingContext {
  readonly provider: PaymentProviderPort;
  readonly email: EmailPort;
  readonly appName: string;
  readonly appUrl: string;
  readonly credentialSecret: string;
  readonly fees: { readonly bps: number; readonly fixedMinor: number };
  /** Minutes a reservation stays alive (default 10). */
  readonly holdMinutes?: number;
}

export const DEFAULT_HOLD_MINUTES = 10;

/** Opaque, URL-safe token derived from a server key. Revocable by bumping `version`. */
export function deriveToken(secret: string, scope: string, id: string, version: number): string {
  return createHmac("sha256", secret).update(`${scope}:${id}:${version}`).digest("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const TOKEN_SCOPES = {
  orderAccess: "order-access",
  ticketView: "ticket-view",
  ticketQr: "ticket-qr",
} as const;
