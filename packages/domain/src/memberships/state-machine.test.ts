import { describe, expect, it } from "vitest";
import { computeValidity, membershipStateMachine } from "./state-machine";

describe("membership state machine", () => {
  it("allows the documented transitions and nothing else", () => {
    expect(membershipStateMachine.canTransition("pending", "awaiting_payment")).toBe(true);
    expect(membershipStateMachine.canTransition("pending", "active")).toBe(true);
    expect(membershipStateMachine.canTransition("awaiting_payment", "active")).toBe(true);
    expect(membershipStateMachine.canTransition("active", "suspended")).toBe(true);
    expect(membershipStateMachine.canTransition("suspended", "active")).toBe(true);
    expect(membershipStateMachine.canTransition("active", "expired")).toBe(true);
    // Terminal states never move; a paid membership never goes back to pending.
    expect(membershipStateMachine.canTransition("expired", "active")).toBe(false);
    expect(membershipStateMachine.canTransition("cancelled", "active")).toBe(false);
    expect(membershipStateMachine.canTransition("rejected", "pending")).toBe(false);
    expect(membershipStateMachine.canTransition("active", "pending")).toBe(false);
    expect(membershipStateMachine.canTransition("awaiting_payment", "suspended")).toBe(false);
  });
});

describe("computeValidity", () => {
  const activation = new Date("2026-10-28T10:00:00Z");
  it("fixed plans keep the season window whatever the activation date", () => {
    const v = computeValidity(
      {
        periodKind: "fixed",
        validFrom: new Date("2026-09-01T00:00:00Z"),
        validUntil: new Date("2027-06-30T22:00:00Z"),
        durationMonths: null,
      },
      activation,
      null,
    );
    expect(v.validFrom.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(v.validUntil.toISOString()).toBe("2027-06-30T22:00:00.000Z");
  });
  it("rolling plans start at activation and last N months", () => {
    const v = computeValidity(
      { periodKind: "rolling", validFrom: null, validUntil: null, durationMonths: 6 },
      activation,
      null,
    );
    expect(v.validFrom).toEqual(activation);
    expect(v.validUntil.toISOString()).toBe("2027-04-28T10:00:00.000Z");
  });
  it("a renewal paid early chains after the previous validity; paid late starts at activation", () => {
    const early = computeValidity(
      { periodKind: "rolling", validFrom: null, validUntil: null, durationMonths: 12 },
      activation,
      new Date("2026-12-01T00:00:00Z"),
    );
    expect(early.validFrom.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(early.validUntil.toISOString()).toBe("2027-12-01T00:00:00.000Z");
    const late = computeValidity(
      { periodKind: "rolling", validFrom: null, validUntil: null, durationMonths: 12 },
      activation,
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(late.validFrom).toEqual(activation);
  });
  it("a fixed plan without dates is a programming error, not a silent window", () => {
    expect(() =>
      computeValidity(
        { periodKind: "fixed", validFrom: null, validUntil: null, durationMonths: null },
        activation,
        null,
      ),
    ).toThrow();
  });
});
