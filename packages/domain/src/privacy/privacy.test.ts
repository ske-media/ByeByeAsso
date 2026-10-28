import { describe, expect, it } from "vitest";
import { replacementEmailFor } from "../identity";
import { deleteAccountSchema } from "./privacy";

describe("privacy · helpers", () => {
  it("builds a unique, lower-case, undeliverable replacement address", () => {
    const e = replacementEmailFor("6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b");
    expect(e).toBe("deleted-6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b@anonymised.kroov.invalid");
    expect(e).toBe(e.toLowerCase());
    expect(e.endsWith(".invalid")).toBe(true);
  });

  it("normalises the confirmation e-mail", () => {
    expect(deleteAccountSchema.parse({ confirmEmail: "  Lea@Example.FR " }).confirmEmail).toBe("lea@example.fr");
    expect(deleteAccountSchema.safeParse({ confirmEmail: "nope" }).success).toBe(false);
  });
});
