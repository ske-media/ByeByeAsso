import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 10 — automated accessibility audit (axe-core, WCAG 2.x A/AA tags) on the key screens:
 * public, authentication, organizer workspace, personal space. Fails on any `serious` or
 * `critical` violation; `moderate` / `minor` ones are reported in the test output.
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const lea = { name: "Léa Martin", email: `lea-a11y-${run}@e2e.kroov.local` };
const slug = `a11y-${run}`;
const eventSlug = `nuit-a11y-${run}`;

function dateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const others = results.violations.filter((v) => v.impact !== "serious" && v.impact !== "critical");
  if (others.length > 0) {
    console.log(`[a11y] ${label}: ${others.map((v) => `${v.id}(${v.impact}, ${v.nodes.length})`).join(", ")}`);
  }
  expect(
    blocking.map(
      (v) =>
        `${v.id}: ${v.help} — ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(" | ")}`,
    ),
    `${label} — violations bloquantes`,
  ).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 10 — accessibilité (axe-core)", () => {
  test("pages publiques et authentification", async ({ page }) => {
    await page.goto("/");
    await audit(page, "accueil");
    await page.goto("/connexion");
    await audit(page, "connexion");
    await page.goto("/inscription");
    await audit(page, "inscription");
    await page.goto("/mot-de-passe-oublie");
    await audit(page, "mot de passe oublié");
  });

  test("espace organisateur : vue d'ensemble, événement, billets, tâches, finances, notifications", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`/inscription?next=${encodeURIComponent("/organisations/nouvelle")}`);
    await page.getByLabel(/Votre nom/).fill(lea.name);
    await page.getByLabel(/Adresse e-mail/).fill(lea.email);
    await page.getByLabel(/^Mot de passe/).fill(password);
    await page.getByRole("button", { name: /Créer mon compte/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Confirmez votre adresse");
    await audit(page, "confirmation d'adresse");
    await page.goto(onBase(lastLinkTo(lea.email, /https?:\/\/\S+verify-email\S+/), baseURL!));
    await page.goto(`/connexion?next=${encodeURIComponent("/organisations/nouvelle")}`);
    if (page.url().includes("/connexion")) {
      await page.getByLabel(/Adresse e-mail/).fill(lea.email);
      await page.getByLabel(/^Mot de passe/).fill(password);
      await page.getByRole("button", { name: /Se connecter/ }).click();
    }
    await expect(page.getByLabel(/^Nom/)).toBeVisible();
    await audit(page, "nouvelle organisation");
    await page.getByLabel(/^Nom/).fill(`Collectif A11y ${run}`);
    await page.getByLabel(/Identifiant d'adresse/).fill(slug);
    await page.getByRole("button", { name: /Créer l'organisation/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
    await audit(page, "vue d'ensemble");
    await page.goto(`/o/${slug}/evenements/nouveau`);
    await audit(page, "nouvel événement");
    await page.getByLabel(/^Titre/).fill(`Nuit A11y ${run}`);
    await page.getByLabel(/Identifiant d'adresse/).fill(eventSlug);
    await page
      .getByLabel(/^Description/)
      .fill("Une nuit entière de musique, trois scènes et un espace calme pour souffler.");
    await page.getByLabel(/Date de début/).fill(dateInDays(14));
    await page.getByLabel(/Heure de début/).fill("21:00");
    await page.getByLabel(/Date de fin/).fill(dateInDays(15));
    await page.getByLabel(/Heure de fin/).fill("03:00");
    await page.getByLabel(/^Capacité/).fill("100");
    await page.getByRole("button", { name: "Créer l'événement" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/evenements/${eventSlug}$`));
    await audit(page, "pilotage d'événement");
    await page.goto(`/o/${slug}/evenements/${eventSlug}/billets`);
    await audit(page, "configuration des billets");
    await page.goto(`/o/${slug}/taches`);
    await audit(page, "tâches");
    await page.getByRole("button", { name: "+ Nouvelle tâche" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await audit(page, "dialogue nouvelle tâche");
    await page.keyboard.press("Escape");
    await page.goto(`/o/${slug}/finances`);
    await audit(page, "finances");
    await page.goto(`/o/${slug}/notifications`);
    await audit(page, "notifications");
    await page.goto(`/o/${slug}/contacts`);
    await audit(page, "contacts");
    await page.goto(`/o/${slug}/equipe`);
    await audit(page, "équipe");
    await page.goto(`/o/${slug}/parametres`);
    await audit(page, "paramètres");
  });

  test("espace personnel et page publique d'organisation", async ({ page }) => {
    await page.goto("/moi");
    await audit(page, "mon compte");
    await page.goto("/organisations");
    await audit(page, "mes organisations");
    await page.goto(`/${slug}`);
    await audit(page, "page publique de l'organisation");
  });
});
