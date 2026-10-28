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

  it("derives APP_ENV safely: production when NODE_ENV is production and APP_ENV unset", () => {
    // A development configuration run as production is refused (phase 10 guards), never silently accepted.
    expect(() => loadServerEnv({ ...minimal, NODE_ENV: "production" })).toThrow(EnvValidationError);
    expect(loadServerEnv({ ...minimal, NODE_ENV: "production", APP_ENV: "test" }).APP_ENV).toBe("test");
    expect(loadServerEnv({ ...minimal }).APP_ENV).toBe("development");
  });

  it("rejects a short AUTH_SECRET", () => {
    expect(() => loadServerEnv({ ...minimal, AUTH_SECRET: "trop-court" })).toThrow(/AUTH_SECRET/);
  });
});

describe("production guards (phase 10)", () => {
  const prod = {
    APP_ENV: "production",
    APP_URL: "https://app.kroov.fr",
    DATABASE_URL: "postgres://app:s3cr3t@db.internal:5432/kroov",
    AUTH_SECRET: "a-very-long-production-secret-of-at-least-32-chars",
    PAYMENT_PROVIDER: "stripe",
    STRIPE_SECRET_KEY: "sk_live_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_x",
    EMAIL_WEBHOOK_SECRET: "a-real-webhook-secret-value",
  };

  it("accepts a complete production configuration", () => {
    expect(loadServerEnv(prod).APP_ENV).toBe("production");
  });

  it("refuses development defaults in production, listing every issue", () => {
    try {
      loadServerEnv({
        ...prod,
        PAYMENT_PROVIDER: "fake",
        EMAIL_PROVIDER: "console",
        EMAIL_WEBHOOK_SECRET: undefined,
        APP_URL: "http://app",
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues.join("\n");
      expect(issues).toContain("PAYMENT_PROVIDER");
      expect(issues).toContain("EMAIL_PROVIDER");
      expect(issues).toContain("EMAIL_WEBHOOK_SECRET");
      expect(issues).toContain("APP_URL");
    }
  });

  it("does not apply the guards to development or test", () => {
    expect(loadServerEnv({ ...minimal, APP_ENV: "test" }).PAYMENT_PROVIDER).toBe("fake");
  });
});
