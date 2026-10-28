import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";

// Monorepo: the single source of configuration is the repo-root .env (never committed).
// Existing process variables always win (CI, hosting provider).
loadDotenv({ path: resolve(import.meta.dirname, "../../.env"), override: false, quiet: true });

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
      ],
    },
  ],
};

export default nextConfig;
