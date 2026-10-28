import { z } from "zod";

/**
 * Environment schema — the single trust boundary between process.env and the app.
 *
 * Rules:
 * - Every variable is declared here with its type and whether it is required.
 * - Secrets are never given defaults. Missing secrets fail fast at boot.
 * - `NEXT_PUBLIC_*` variables are the only ones ever exposed to the browser.
 */

const nodeEnv = z.enum(["development", "test", "production"]).default("development");

const url = z.string().url();

const appEnv = z.enum(["development", "test", "staging", "production"]);

export const serverEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  /**
   * Deployment environment for POLICY decisions (console e-mail allowed? secure cookies?
   * rate limiting?). NODE_ENV belongs to the framework (`next build` always sets production).
   * Defaults to the safe value: production whenever NODE_ENV is production.
   */
  APP_ENV: appEnv.optional(),
  APP_NAME: z.string().min(1).default("Kroov"),
  APP_URL: url.default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // PostgreSQL (authoritative store). No default: a wrong database must never be silently used.
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
  DATABASE_URL_TEST: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

  // Authentication secret (Phase 1). 32+ chars enforced when present.
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET doit faire au moins 32 caractères").optional(),

  // Payments (Phase 3).
  /** `stripe` in staging/production; `fake` (local simulated provider) only in development/test. */
  PAYMENT_PROVIDER: z.enum(["stripe", "fake"]).default("fake"),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
  /** HMAC secret signing the simulated provider's webhooks (fake provider only). */
  FAKE_PAYMENT_WEBHOOK_SECRET: z.string().min(16).default("fake-webhook-secret-for-local-use-only"),
  /** Buyer fee per paid ticket = platform commission: basis points of the ticket price + fixed minor units. */
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(400),
  PLATFORM_FEE_FIXED_MINOR: z.coerce.number().int().min(0).max(100_000).default(0),

  // Email provider adapter (Phase 1 for transactional, Phase 8 for campaigns).
  EMAIL_PROVIDER: z.enum(["console", "file", "smtp", "resend"]).default("console"),
  /** File adapter output (tests only). */
  EMAIL_FILE_PATH: z.string().optional(),
  EMAIL_FROM: z.string().email().default("no-reply@kroov.local"),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  /** HMAC secret for provider delivery callbacks (fake provider in tests, Resend/svix signing secret in production). */
  EMAIL_WEBHOOK_SECRET: z.string().min(16).default("fake-email-webhook-secret-local-only"),
  /** Campaign dispatch: recipients per batch (one short transaction per batch). */
  CAMPAIGN_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),

  // S3-compatible object storage.
  S3_ENDPOINT: url.optional(),
  S3_REGION: z.string().default("eu-west-3"),
  S3_BUCKET: z.string().default("kroov-dev"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // Worker.
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),

  // Hardening (phase 10)
  /** Trust `x-forwarded-for` (first address) as the client address — ONLY behind the declared reverse proxy. */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Bearer token protecting GET /api/v1/metrics (unset = endpoint disabled). */
  METRICS_TOKEN: z.string().min(16).optional(),
  /** Multiplier applied to every public rate limit (1 = defaults; tests may raise it). */
  RATE_LIMIT_FACTOR: z.coerce.number().min(0.01).max(1000).default(1),
});

export type ServerEnv = Omit<z.infer<typeof serverEnvSchema>, "APP_ENV"> & { APP_ENV: AppEnv };
export type AppEnv = z.infer<typeof appEnv>;

function resolveAppEnv(parsed: z.infer<typeof serverEnvSchema>): ServerEnv {
  const APP_ENV: AppEnv = parsed.APP_ENV ?? (parsed.NODE_ENV === "production" ? "production" : parsed.NODE_ENV);
  return { ...parsed, APP_ENV };
}

/**
 * Production / staging guards (phase 10): a deployment that could leak or fake something fails
 * at startup with every issue listed, instead of running with development defaults.
 */
export function productionIssues(env: ServerEnv): string[] {
  if (env.APP_ENV !== "production" && env.APP_ENV !== "staging") return [];
  const issues: string[] = [];
  if (!env.AUTH_SECRET) issues.push("AUTH_SECRET: requis en production (dérivation des jetons, sessions)");
  if (!env.APP_URL.startsWith("https://")) issues.push("APP_URL: doit être en https en production");
  if (env.PAYMENT_PROVIDER === "fake")
    issues.push("PAYMENT_PROVIDER: le prestataire simulé est interdit en production");
  if (env.PAYMENT_PROVIDER === "stripe" && (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET))
    issues.push("STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET: requis avec PAYMENT_PROVIDER=stripe");
  if (env.EMAIL_PROVIDER === "console" || env.EMAIL_PROVIDER === "file")
    issues.push("EMAIL_PROVIDER: console/file sont réservés au développement et aux tests");
  if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY)
    issues.push("RESEND_API_KEY: requis avec EMAIL_PROVIDER=resend");
  if (env.EMAIL_PROVIDER === "smtp" && !env.SMTP_URL) issues.push("SMTP_URL: requis avec EMAIL_PROVIDER=smtp");
  if (env.EMAIL_WEBHOOK_SECRET === "fake-email-webhook-secret-local-only")
    issues.push("EMAIL_WEBHOOK_SECRET: la valeur par défaut de développement est interdite en production");
  if (env.DATABASE_URL.includes("kroov:kroov@")) issues.push("DATABASE_URL: identifiants de développement détectés");
  return issues;
}

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: url.default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Kroov"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuration d'environnement invalide :\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/**
 * `.env` templates leave optional values empty (`STRIPE_SECRET_KEY=`). An empty string
 * means "not configured", never a valid value, so it is normalised to undefined before parsing.
 */
function withoutEmptyStrings(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === "" ? undefined : value;
  }
  return out;
}

/**
 * Parse server environment. Throws EnvValidationError with every issue listed.
 */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(withoutEmptyStrings(source));
  if (!result.success) {
    throw new EnvValidationError(formatIssues(result.error));
  }
  const env = resolveAppEnv(result.data);
  const issues = productionIssues(env);
  if (issues.length > 0) throw new EnvValidationError(issues);
  return env;
}

export function loadPublicEnv(source: NodeJS.ProcessEnv = process.env): PublicEnv {
  const result = publicEnvSchema.safeParse(withoutEmptyStrings(source));
  if (!result.success) {
    throw new EnvValidationError(formatIssues(result.error));
  }
  return result.data;
}

let cachedServerEnv: ServerEnv | undefined;

/** Memoised accessor for long-running processes. Tests should call loadServerEnv directly. */
export function serverEnv(): ServerEnv {
  if (!cachedServerEnv) {
    cachedServerEnv = loadServerEnv();
  }
  return cachedServerEnv;
}

/** Test-only: clear the cached env. */
export function resetServerEnvCache(): void {
  cachedServerEnv = undefined;
}
