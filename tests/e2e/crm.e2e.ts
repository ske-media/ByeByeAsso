import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 7 journey in the browser:
 * formule gratuite → deux adhésions (avec / sans case marketing) → contacts automatiques avec statuts de
 * consentement distincts → fiche 360° (journal, étiquette, note) → consentement manuel avec preuve →
 * segment « consentis » avec aperçu réel → exclusion d'une adresse puis levée motivée → fusion d'un doublon.
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const lea = { name: "Léa Martin", email: `lea-c-${run}@e2e.kroov.local` };
const orgName = `Collectif Contacts ${run}`;
const slug = `contacts-${run}`;
const noeEmail = `noe-${run}@e2e.kroov.local`;
const samEmail = `sam-${run}@e2e.kroov.local`;
const dupEmail = `noe.garnier-${run}@e2e.kroov.local`;

function dateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const badge = (page: Page, label: string) =>
  page.getByText(new RegExp(`^•?\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));

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

async function joinFree(page: Page, first: string, last: string, email: string, optIn: boolean) {
  await page.context().clearCookies();
  await page.goto(`/${slug}/adherer`);
  await page.getByText("Sympathisant", { exact: true }).click();
  await page.getByLabel(/^Prénom/).fill(first);
  await page.getByLabel(/^Nom/).fill(last);
  await page.getByLabel(/^E-mail/).fill(email);
  if (optIn) await page.getByLabel(/recevoir les actualités/).check();
  await page.getByRole("button", { name: /Adhérer gratuitement/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Vous faites partie/);
}

test.describe.configure({ mode: "serial" });

let noeId = "";

test.describe("Phase 7 — contacts et consentements", () => {
  test("Léa prépare une formule gratuite ; Noé (case cochée) et Sam (sans) adhèrent", async ({ page, baseURL }) => {
    await signUpAndVerify(page, baseURL!, lea, "/organisations/nouvelle");
    await signIn(page, lea.email, "/organisations/nouvelle");
    await page.getByLabel(/^Nom/).fill(orgName);
    await page.getByLabel(/Identifiant d'adresse/).fill(slug);
    await page.getByRole("button", { name: /Créer l'organisation/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}`));
    await page.goto(`/o/${slug}/adhesions/formules/nouvelle`);
    await page.getByLabel(/^Nom\b/).fill("Sympathisant");
    await page.getByLabel(/^Montant/).fill("0");
    await page.getByLabel(/Début de validité/).fill(dateInDays(-1));
    await page.getByLabel(/Fin de validité/).fill(dateInDays(200));
    await page.getByRole("button", { name: "Enregistrer la formule" }).click();
    await expect(page.getByText("Formule créée")).toBeVisible();
    await joinFree(page, "Noé", "Garnier", noeEmail, true);
    await joinFree(page, "Sam", "Moreau", samEmail, false);
  });

  test("les contacts existent avec des statuts distincts ; fiche 360°, étiquette, note, consentement manuel, segment", async ({
    page,
  }) => {
    await signIn(page, lea.email, `/o/${slug}/contacts`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Une base, une organisation.");
    await expect(page.getByText("Contacts actifs", { exact: true }).locator("..")).toContainText("2");
    await expect(page.getByText("Consentis (e-mail)", { exact: true }).locator("..")).toContainText("1");
    const noeRow = page.getByRole("row", { name: new RegExp(noeEmail) });
    await expect(noeRow).toContainText("Consentement explicite");
    await expect(noeRow).toContainText("1 adhésion(s)");
    const samRow = page.getByRole("row", { name: new RegExp(samEmail) });
    await expect(samRow).toContainText("Aucun consentement");

    // Tag created from the tab, then applied from the card.
    await page.goto(`/o/${slug}/contacts?onglet=etiquettes`);
    await page.getByRole("button", { name: "+ Nouvelle étiquette" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/Nom de l'étiquette/)
      .fill("VIP");
    await page.getByRole("dialog").getByRole("button", { name: "Créer l'étiquette" }).click();
    await expect(page.getByText("VIP", { exact: true }).first()).toBeVisible();

    await page.goto(`/o/${slug}/contacts`);
    await noeRow.getByRole("link", { name: /Ouvrir/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Noé Garnier");
    noeId = page.url().split("/contacts/")[1]!;
    await expect(page.getByText(/Case « recevoir les actualités » cochée/).first()).toBeVisible();
    await expect(page.getByText(/Adhésion M-0001/)).toBeVisible();
    await page.getByRole("checkbox", { name: "VIP" }).check();
    await page.getByRole("button", { name: "Enregistrer les étiquettes" }).click();
    await expect(page.getByText("Étiquettes enregistrées.")).toBeVisible();
    await page.getByLabel(/Nouvelle note/).fill("Préfère être contactée le soir.");
    await page.getByRole("button", { name: "Ajouter la note" }).click();
    await expect(page.getByText("Préfère être contactée le soir.")).toBeVisible();
    await expect(page.getByText("Léa Martin ·")).toBeVisible();

    // Sam: manual consent with evidence → opted_in.
    await page.goto(`/o/${slug}/contacts`);
    await samRow.getByRole("link", { name: /Ouvrir/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Sam Moreau");
    await expect(page.getByText(/n'a jamais coché la case/)).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer un consentement ou un retrait" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/^Preuve/)
      .fill("Bulletin papier signé au stand le 12 juin");
    await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText(/désormais consentie/)).toBeVisible();
    await expect(badge(page, "Consentement explicite").first()).toBeVisible();

    // Segment: consented contacts → live preview counts both.
    await page.goto(`/o/${slug}/contacts/segments/nouveau`);
    await page.getByLabel(/Nom du segment/).fill("Consentis");
    await expect(page.getByText("contact(s) correspondant(s)")).toBeVisible();
    await expect(page.getByText("contact(s) correspondant(s)").locator("..")).toContainText("2 consenti(s)");
    await page.getByRole("button", { name: "Créer le segment" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Consentis");
    await page.goto(`/o/${slug}/contacts/segments`);
    await expect(page.getByRole("row", { name: /Consentis/ })).toContainText("2");
  });

  test("exclusion d'une adresse puis levée motivée ; fusion d'un doublon ; export disponible", async ({ page }) => {
    await signIn(page, lea.email, `/o/${slug}/contacts/exclusions`);
    await page.getByRole("button", { name: "+ Exclure une adresse" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/Adresse e-mail/)
      .fill(samEmail);
    await page
      .getByRole("dialog")
      .getByLabel(/^Motif/)
      .selectOption("complaint");
    await page.getByRole("dialog").getByRole("button", { name: "Exclure cette adresse" }).click();
    await expect(page.getByRole("row", { name: new RegExp(samEmail) })).toContainText("Plainte");
    await page.goto(`/o/${slug}/contacts`);
    await expect(page.getByRole("row", { name: new RegExp(samEmail) })).toContainText("Exclu·e");
    await expect(page.getByText("Exclu·es", { exact: true }).locator("..")).toContainText("1");
    await page.goto(`/o/${slug}/contacts/exclusions`);
    await page.getByRole("button", { name: "Lever…" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/Motif de la levée/)
      .fill("Erreur de saisie confirmée par la personne");
    await page.getByRole("dialog").getByRole("button", { name: "Lever l'exclusion" }).click();
    await expect(page.getByText("Aucune exclusion")).toBeVisible();
    await page.goto(`/o/${slug}/contacts`);
    await expect(page.getByRole("row", { name: new RegExp(samEmail) })).toContainText("Consentement explicite");

    // Duplicate created by hand, then merged into Noé.
    await page.getByRole("button", { name: "+ Nouveau contact" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/^E-mail/)
      .fill(dupEmail);
    await page
      .getByRole("dialog")
      .getByLabel(/^Prénom/)
      .fill("Noé");
    await page
      .getByRole("dialog")
      .getByLabel(/^Nom\b/)
      .fill("Garnier");
    await page.getByRole("dialog").getByRole("button", { name: "Créer le contact" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Noé Garnier");
    await page.goto(`/o/${slug}/contacts?onglet=doublons`);
    await expect(page.getByText(/Nom « noé garnier »/)).toBeVisible();
    await page.goto(`/o/${slug}/contacts/${noeId}`);
    await page.getByLabel("Rechercher un doublon").fill(dupEmail);
    await page.getByRole("button", { name: "Chercher" }).click();
    await page.getByRole("button", { name: "Choisir" }).click();
    await page.getByRole("button", { name: "Fusionner", exact: true }).click();
    await expect(page.getByText(/Fiches fusionnées/)).toBeVisible();
    await expect(page.getByText(dupEmail).first()).toBeVisible();
    await page.goto(`/o/${slug}/contacts`);
    await expect(page.getByText("Contacts actifs", { exact: true }).locator("..")).toContainText("2");
    await expect(page.getByRole("link", { name: /Exporter CSV \(2\)/ })).toBeVisible();
  });
});
