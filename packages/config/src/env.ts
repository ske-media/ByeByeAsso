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

export const serverEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  APP_NAME: z.string().min(1).default("Kroov"),
  APP_URL: url.default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // PostgreSQL (authoritative store). No default: a wrong database must never be silently used.
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
  DATABASE_URL_TEST: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

  // Authentication secret (Phase 1). 32+ chars enforced when present.
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET doit faire au moins 32 caractères").optional(),

  // Payments (Phase 3). Declared now so configuration is explicit from day one.
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),

  // Email provider adapter (Phase 1 for transactional, Phase 8 for campaigns).
  EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).default("console"),
  EMAIL_FROM: z.string().email().default("no-reply@kroov.local"),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

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
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

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
  return result.data;
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
