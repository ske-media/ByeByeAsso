import { describe, expect, it } from "vitest";
import { addMoney, applyBasisPoints, formatMoney, money, multiplyMoney, subtractMoney, sumMoney } from "./money";

describe("Money (integer minor units)", () => {
  it("computes the demo gross revenue: 480 × 24 € + 144 × 30 € = 15 840 €", () => {
    const wave1 = multiplyMoney(money(2400), 480);
    const standard = multiplyMoney(money(3000), 144);
    const gross = addMoney(wave1, standard);
    expect(gross.amountMinor).toBe(1_584_000);
    // fr-FR typography: narrow no-break space (U+202F) for grouping, no-break space (U+00A0) before €.
    expect(formatMoney(gross)).toBe("15\u202f840,00\u00a0€");
  });

  it("applies a 2 % organizer fee in basis points: 316,80 €", () => {
    const fee = applyBasisPoints(money(1_584_000), 200);
    expect(fee.amountMinor).toBe(31_680);
    expect(subtractMoney(money(1_584_000), fee).amountMinor).toBe(1_552_320);
  });

  it("computes the KR-1048 order: 2 × 30 € + 2,40 € fees = 62,40 €", () => {
    const tickets = multiplyMoney(money(3000), 2);
    const total = sumMoney([tickets, money(240)]);
    expect(total.amountMinor).toBe(6240);
  });

  it("refuses floats, negatives and mixed currencies", () => {
    expect(() => money(24.4)).toThrow();
    expect(() => money(-1)).toThrow();
    expect(() => subtractMoney(money(100), money(200))).toThrow();
  });
});
