import { expect, test } from "@playwright/test";

test.describe("Phase 0 smoke", () => {
  test("home page renders the product promise in French with a single h1", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Kroov/);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText("Organisez vos événements");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  test("health endpoint reports the real database status", async ({ request }) => {
    const response = await request.get("/api/v1/health");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string; checks: { database: { ok: boolean } } };
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
  });

  test("unknown routes return the French 404 page", async ({ page }) => {
    const response = await page.goto("/cette-page-n-existe-pas");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cette page n'existe pas");
  });

  test("home page has no horizontal overflow at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
