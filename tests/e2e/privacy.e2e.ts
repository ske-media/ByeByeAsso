import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 10 journey: Mia creates an account, exports her data, then deletes her account from
 * « Mon compte » (confirmation by typing her address) → signed out, confirmation page, the old
 * credentials no longer sign in, the address can register again.
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const mia = { name: "Mia Lambert", email: `mia-p-${run}@e2e.kroov.local` };

async function signUpAndVerify(page: Page, baseURL: string, user: { name: string; email: string }, next: string) {
  await page.goto(`/inscription?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/Votre nom/).fill(user.name);
  await page.getByLabel(/Adresse e-mail/).fill(user.email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Confirmez votre adresse");
  await page.goto(onBase(lastLinkTo(user.email, /https?:\/\/\S+verify-email\S+/), baseURL));
}

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  if (!page.url().includes("/connexion")) return;
  await page.getByLabel(/Adresse e-mail/).fill(email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByRole("button", { name: /Se connecter/ }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 10 — mes données", () => {
  test("Mia exporte ses données puis supprime son compte", async ({ page, baseURL }) => {
    await signUpAndVerify(page, baseURL!, mia, "/moi");
    await signIn(page, mia.email, "/moi");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Profil et préférences");
    await expect(page.getByRole("heading", { name: "Mes données" })).toBeVisible();
    const exported = await page.request.get("/api/v1/profiles/me/export");
    expect(exported.status()).toBe(200);
    const data = (await exported.json()) as { profile: { email: string }; retentionNote: string };
    expect(data.profile.email).toBe(mia.email);
    expect(data.retentionNote).toContain("conservés");

    await page.getByRole("button", { name: /Supprimer mon compte…/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Supprimer définitivement votre compte ?");
    await page
      .getByRole("dialog")
      .getByLabel(/Adresse e-mail du compte/)
      .fill("pas-la-bonne@e2e.kroov.local");
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer mon compte" }).click();
    await expect(page.getByText(/Saisissez l'adresse e-mail exacte/)).toBeVisible();
    await page
      .getByRole("dialog")
      .getByLabel(/Adresse e-mail du compte/)
      .fill(mia.email);
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer mon compte" }).click();
    await expect(page).toHaveURL(/\/moi\/compte-supprime$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Votre compte a été supprimé.");

    // Signed out: the account page redirects to sign-in; the old password is refused.
    await page.goto("/moi");
    await expect(page).toHaveURL(/\/connexion/);
    await page.getByLabel(/Adresse e-mail/).fill(mia.email);
    await page.getByLabel(/^Mot de passe/).fill(password);
    await page.getByRole("button", { name: /Se connecter/ }).click();
    await expect(page).toHaveURL(/\/connexion/);
    await expect(page.getByRole("alert")).toBeVisible();
    // The address is free again.
    await page.goto("/inscription");
    await page.getByLabel(/Votre nom/).fill("Mia bis");
    await page.getByLabel(/Adresse e-mail/).fill(mia.email);
    await page.getByLabel(/^Mot de passe/).fill(password);
    await page.getByRole("button", { name: /Créer mon compte/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Confirmez votre adresse");
  });
});
