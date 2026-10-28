import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";

// Monorepo: the single source of configuration is the repo-root .env (never committed).
// Existing process variables always win (CI, hosting provider).
loadDotenv({ path: resolve(import.meta.dirname, "../../.env"), override: false, quiet: true });

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(process.env.APP_ENV === "production" || process.env.APP_ENV === "staging" ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: [
    "@kroov/ui",
    "@kroov/domain",
    "@kroov/validation",
    "@kroov/config",
    "@kroov/auth",
    "@kroov/database",
    "@kroov/payments",
    "@kroov/notifications",
  ],
  // Server-only native modules must not be bundled.
  serverExternalPackages: ["pg", "pino", "stripe"],
  poweredByHeader: false,
  // Keep the repo clean: do not generate AGENTS.md in apps/web.
  agentRules: false,
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        // Phase 10: no external origin is ever loaded. Inline scripts/styles are what the App Router
        // emits without a nonce strategy (documented evolution: nonce-based strict CSP).
        { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
        ...(process.env.APP_ENV === "production" || process.env.APP_ENV === "staging"
          ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
          : []),
      ],
    },
  ],
};

export default nextConfig;
