/**
 * ticketing module — public API (phase 3): ticket types, pools, promo codes, orders and
 * reservations, checkout, provider webhooks, refunds, tickets and check-ins, ledger.
 * Other modules import ONLY from this file.
 */
export const MODULE_NAME = "ticketing" as const;

export * from "./checkins";
export { DEFAULT_HOLD_MINUTES, deriveToken, hashToken, type TicketingContext, TOKEN_SCOPES } from "./context";
export { sendOrderConfirmation } from "./emails";
export { ledgerBalances } from "./ledger";
export * from "./orders";
export * from "./payments";
export { allocateDiscount, computeTotals, type FeePolicy, type OrderTotals, unitFee } from "./pricing";
export * from "./refunds";
export * from "./schemas";
export * from "./state-machines";
export * from "./ticket-types";
