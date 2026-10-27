import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * E2E configuration. By default starts the production build of apps/web
 * (`pnpm --filter @kroov/web start`) unless E2E_BASE_URL points at a running server.
 * Two projects mirror the UX kit reference widths: desktop 1440 px and mobile 390 px.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: "pnpm --filter @kroov/web start",
          url: `${baseURL}/api/v1/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          cwd: "../..",
        },
      }),
});
