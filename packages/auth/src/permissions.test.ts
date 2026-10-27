import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES } from "./catalogue";

describe("permission catalogue", () => {
  it("has unique, dotted permission names", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z]+\.[a-z]+$/);
  });

  it("grants only declared permissions to every role (deny by default)", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const p of DEFAULT_ROLE_PERMISSIONS[role]) expect(known.has(p)).toBe(true);
    }
  });

  it("keeps billing.manage exclusive to the owner by default", () => {
    for (const role of ROLES) {
      const has = DEFAULT_ROLE_PERMISSIONS[role].includes("billing.manage");
      expect(has).toBe(role === "owner");
    }
  });

  it("restricts the scanner role to check-in scope", () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.scanner].sort()).toEqual(["checkins.scan", "events.read"]);
  });
});
