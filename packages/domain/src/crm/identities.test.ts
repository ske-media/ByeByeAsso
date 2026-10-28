import { describe, expect, it } from "vitest";
import { csvEscape, deriveMarketingStatus, normalizeEmail, normalizePhone, slugify } from "./identities";

const at = (iso: string) => new Date(iso);

describe("crm identities", () => {
  it("normalises e-mails (case, surrounding and inner whitespace)", () => {
    expect(normalizeEmail("  Maya.Test@Example.ORG ")).toBe("maya.test@example.org");
    expect(normalizeEmail("a b@c.fr")).toBe("ab@c.fr");
  });

  it("normalises phones to E.164 for duplicate detection only", () => {
    expect(normalizePhone("06 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("0041 79 123 45 67")).toBe("+41791234567");
    expect(normalizePhone("+41 79 123 45 67")).toBe("+41791234567");
    expect(normalizePhone("079 123 45 67", "CH")).toBe("+41791234567");
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("slugifies tag and segment names", () => {
    expect(slugify("Bénévoles Été 2027 !")).toBe("benevoles-ete-2027");
  });

  it("escapes CSV cells and neutralises formula injection", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape('a;b "c"')).toBe('"a;b ""c"""');
    expect(csvEscape("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvEscape(null)).toBe("");
  });
});

describe("deriveMarketingStatus", () => {
  it("is none without any record and suppressed when excluded, whatever the journal says", () => {
    expect(deriveMarketingStatus([], false)).toBe("none");
    expect(
      deriveMarketingStatus([{ status: "granted", basis: "explicit_opt_in", occurredAt: at("2026-01-01") }], true),
    ).toBe("suppressed");
  });

  it("a purchase without the box ticked is customer_only, never opted_in", () => {
    expect(
      deriveMarketingStatus([{ status: "granted", basis: "customer_exception", occurredAt: at("2026-01-01") }], false),
    ).toBe("customer_only");
  });

  it("an explicit opt-in wins over customer exception, in any order", () => {
    const records = [
      { status: "granted" as const, basis: "explicit_opt_in" as const, occurredAt: at("2026-01-01") },
      { status: "granted" as const, basis: "customer_exception" as const, occurredAt: at("2026-03-01") },
    ];
    expect(deriveMarketingStatus(records, false)).toBe("opted_in");
    expect(deriveMarketingStatus([...records].reverse(), false)).toBe("opted_in");
  });

  it("a withdrawal is final until a new explicit grant; a later purchase never re-grants", () => {
    expect(
      deriveMarketingStatus(
        [
          { status: "granted", basis: "explicit_opt_in", occurredAt: at("2026-01-01") },
          { status: "withdrawn", basis: "manual", occurredAt: at("2026-02-01") },
          { status: "granted", basis: "customer_exception", occurredAt: at("2026-03-01") },
        ],
        false,
      ),
    ).toBe("withdrawn");
    expect(
      deriveMarketingStatus(
        [
          { status: "withdrawn", basis: "manual", occurredAt: at("2026-02-01") },
          { status: "granted", basis: "explicit_opt_in", occurredAt: at("2026-04-01") },
        ],
        false,
      ),
    ).toBe("opted_in");
  });
});
