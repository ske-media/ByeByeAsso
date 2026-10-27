import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { installFrenchErrorMap, toFieldErrors } from "./messages";
import { emailSchema, intervalSchema, minorUnitsSchema, slugSchema } from "./primitives";
import { validate } from "./result";

beforeAll(() => {
  installFrenchErrorMap();
});

describe("French validation messages", () => {
  it("reports a missing required field in French", () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = validate(schema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.name).toEqual(["Ce champ est obligatoire."]);
    }
  });

  it("reports an invalid e-mail in French", () => {
    const result = validate(emailSchema, "pas-un-email");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors._form?.[0]).toBe("Saisissez une adresse e-mail valide.");
    }
  });

  it("normalises e-mail case and whitespace", () => {
    const result = validate(emailSchema, "  Camille.Durand@Example.ORG ");
    expect(result).toEqual({ ok: true, data: "camille.durand@example.org" });
  });

  it("groups nested paths with dot notation", () => {
    const schema = z.object({ address: z.object({ city: z.string().min(1) }) });
    const errors = toFieldErrors(schema.safeParse({ address: { city: "" } }).error!);
    expect(Object.keys(errors)).toEqual(["address.city"]);
  });
});

describe("primitives", () => {
  it("rejects reserved slugs", () => {
    expect(slugSchema.safeParse("api").success).toBe(false);
    expect(slugSchema.safeParse("le-collectif-des-nuits").success).toBe(true);
    expect(slugSchema.safeParse("Le Collectif").success).toBe(false);
  });

  it("rejects fractional or negative minor units", () => {
    expect(minorUnitsSchema.safeParse(2440).success).toBe(true);
    expect(minorUnitsSchema.safeParse(24.4).success).toBe(false);
    expect(minorUnitsSchema.safeParse(-1).success).toBe(false);
  });

  it("validates an interval crossing midnight", () => {
    const ok = intervalSchema.safeParse({
      start: "2027-06-12T18:00:00+02:00",
      end: "2027-06-13T02:00:00+02:00",
    });
    expect(ok.success).toBe(true);
    const bad = intervalSchema.safeParse({
      start: "2027-06-12T18:00:00+02:00",
      end: "2027-06-12T17:00:00+02:00",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("La fin doit être postérieure au début.");
    }
  });
});
