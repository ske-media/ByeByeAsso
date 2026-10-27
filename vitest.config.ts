import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration with three projects:
 * - unit        : pure tests inside packages/ and apps/ (no database).
 * - integration : tests/integration — real PostgreSQL via DATABASE_URL_TEST.
 * - security    : tests/security — negative tests (tenant isolation, forged ids, secrets).
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/*.test.ts", "packages/**/*.test.tsx", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
          exclude: ["**/node_modules/**", "**/.next/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/integration/setup.ts"],
          // Integration tests share one database: run files sequentially.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "security",
          include: ["tests/security/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
