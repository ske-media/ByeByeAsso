import { describe, expect, it } from "vitest";
import { moneyBlock } from "./dashboards";

/**
 * Ledger conventions (phase 3): order_paid posts D receivable_provider (total), C revenue_tickets
 * (subtotal − discount), C platform_fees (fees); refunds post the opposite. Credits are negative.
 */
describe("analytics · money metrics from ledger balances", () => {
  it("turns credit balances into positive gross / fees and keeps the receivable as is", () => {
    // Two paid orders of 40,00 € + 2,00 € fees, one refund of 20,00 € (ticket part 19,05, fee part 0,95).
    const bal = { revenue_tickets: -(8000 - 1905), platform_fees: -(400 - 95), receivable_provider: 8400 - 2000 };
    const m = moneyBlock(bal, "EUR", 2000);
    expect(m.gross.amountMinor).toBe(6095);
    expect(m.platformFees.amountMinor).toBe(305);
    expect(m.refunds.amountMinor).toBe(2000);
    expect(m.receivableFromProvider.amountMinor).toBe(6400);
    expect(m.netEstimate.amountMinor).toBe(6095);
    expect(m.netEstimate.estimate).toBe(true);
    expect(m.gross.currency).toBe("EUR");
    for (const v of Object.values(m)) expect(v.source.length).toBeGreaterThan(0);
  });

  it("reports zero (never a fabricated figure) when the ledger has no entries", () => {
    const m = moneyBlock({}, "CHF", 0);
    expect(m.gross.amountMinor).toBe(0);
    expect(m.platformFees.amountMinor).toBe(0);
    expect(m.receivableFromProvider.amountMinor).toBe(0);
    expect(m.gross.currency).toBe("CHF");
  });
});
