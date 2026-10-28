import { applyBasisPoints, money } from "../kernel";

/**
 * Pricing rules (integer minor units, never floats):
 * - buyer fee per PAID ticket = price × PLATFORM_FEE_BPS + PLATFORM_FEE_FIXED_MINOR
 *   (free tickets carry no fee and trigger no payment);
 * - promo discount applies to the ticket subtotal, never to fees, and never below zero;
 * - total = subtotal − discount + fees.
 */
export interface FeePolicy {
  readonly bps: number;
  readonly fixedMinor: number;
}

export function unitFee(priceMinor: number, policy: FeePolicy): number {
  if (priceMinor <= 0) return 0;
  return applyBasisPoints(money(priceMinor), policy.bps).amountMinor + policy.fixedMinor;
}

export interface PricedLine {
  readonly ticketTypeId: string;
  readonly label: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly unitFeeMinor: number;
}

export interface Discount {
  readonly kind: "percent" | "amount";
  readonly value: number;
}

export interface OrderTotals {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly feesMinor: number;
  readonly totalMinor: number;
}

export function computeTotals(lines: readonly PricedLine[], discount: Discount | null): OrderTotals {
  const subtotalMinor = lines.reduce((acc, l) => acc + l.unitPriceMinor * l.quantity, 0);
  const feesMinor = lines.reduce((acc, l) => acc + l.unitFeeMinor * l.quantity, 0);
  let discountMinor = 0;
  if (discount && subtotalMinor > 0) {
    discountMinor =
      discount.kind === "percent"
        ? applyBasisPoints(money(subtotalMinor), discount.value).amountMinor
        : Math.min(discount.value, subtotalMinor);
  }
  const totalMinor = subtotalMinor - discountMinor + feesMinor;
  if (totalMinor < 0) throw new Error("Total négatif : règle de tarification violée.");
  return { subtotalMinor, discountMinor, feesMinor, totalMinor };
}

/**
 * Spread an order-level discount over its tickets (for per-ticket refunds): largest remainder
 * so the per-ticket amounts sum exactly to the discount.
 */
export function allocateDiscount(ticketPrices: readonly number[], discountMinor: number): number[] {
  const subtotal = ticketPrices.reduce((a, b) => a + b, 0);
  if (subtotal === 0 || discountMinor === 0) return ticketPrices.map(() => 0);
  const raw = ticketPrices.map((p) => (p * discountMinor) / subtotal);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = discountMinor - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)
    .map((x) => x.i);
  for (const i of order) {
    if (remainder <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    remainder -= 1;
  }
  return floors;
}
