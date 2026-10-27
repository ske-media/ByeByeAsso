import { describe, expect, it } from "vitest";
import { EnvValidationError, loadServerEnv } from "./env";

const minimal = { DATABASE_URL: "postgres://kroov:kroov@localhost:5432/kroov" };

describe("server environment schema", () => {
  it("accepts a minimal configuration and applies defaults", () => {
    const env = loadServerEnv(minimal);
    expect(env.NODE_ENV).toBe("development");
    expect(env.EMAIL_PROVIDER).toBe("console");
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it("fails fast with every issue listed when required values are missing", () => {
    expect(() => loadServerEnv({})).toThrow(EnvValidationError);
    try {
      loadServerEnv({ STRIPE_SECRET_KEY: "nope" });
    } catch (error) {
      const issues = (error as EnvValidationError).issues;
      expect(issues.some((i) => i.startsWith("DATABASE_URL"))).toBe(true);
      expect(issues.some((i) => i.startsWith("STRIPE_SECRET_KEY"))).toBe(true);
    }
  });

  it("treats empty strings from .env templates as not configured", () => {
    const env = loadServerEnv({ ...minimal, AUTH_SECRET: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" });
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("rejects a short AUTH_SECRET", () => {
    expect(() => loadServerEnv({ ...minimal, AUTH_SECRET: "trop-court" })).toThrow(/AUTH_SECRET/);
  });
});
