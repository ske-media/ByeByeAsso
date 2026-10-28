import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 8 journey in the browser (the test server runs the worker too):
 * adhésion consentie → segment « Consentis » → brouillon de campagne → test à soi-même → vérification de
 * l'audience → envoi → le worker envoie par lots → rapport « Envoyée » → lien suivi (redirection avec paramètres
 * de source) → désinscription sans connexion depuis l'e-mail reçu → contact exclu, rapport mis à jour.
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const lea = { name: "Léa Martin", email: `lea-m-${run}@e2e.kroov.local` };
const orgName = `Collectif Marketing ${run}`;
const slug = `marketing-${run}`;
const noeEmail = `noe-m-${run}@e2e.kroov.local`;

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

test.describe.configure({ mode: "serial" });

let campaignUrl = "";

test.describe("Phase 8 — marketing responsable", () => {
  test("Léa prépare une formule, Noé adhère avec la case cochée, un segment « Consentis » existe", async ({
    page,
    baseURL,
  }) => {
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
    await page.context().clearCookies();
    await page.goto(`/${slug}/adherer`);
    await page.getByText("Sympathisant", { exact: true }).click();
    await page.getByLabel(/^Prénom/).fill("Noé");
    await page.getByLabel(/^Nom/).fill("Garnier");
    await page.getByLabel(/^E-mail/).fill(noeEmail);
    await page.getByLabel(/recevoir les actualités/).check();
    await page.getByRole("button", { name: /Adhérer gratuitement/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Vous faites partie/);
    await signIn(page, lea.email, `/o/${slug}/contacts/segments/nouveau`);
    await page.getByLabel(/Nom du segment/).fill("Consentis");
    await expect(page.getByText("contact(s) correspondant(s)").locator("..")).toContainText("1 consenti(s)");
    await page.getByRole("button", { name: "Créer le segment" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Consentis");
  });

  test("brouillon → test → vérification → envoi par le worker → rapport envoyée", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, lea.email, `/o/${slug}/marketing`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Parler aux bonnes personnes.");
    await page.getByRole("link", { name: "+ Nouvelle campagne" }).click();
    await page.getByLabel(/Nom interne/).fill("Les Nuits reviennent");
    const audience = page.getByLabel(/Audience \(segment\)/);
    await audience.selectOption(
      (await audience.locator("option", { hasText: "Consentis" }).getAttribute("value")) ?? "",
    );
    await page.getByLabel(/Nom d'expéditeur/).fill("Le Collectif des Nuits");
    await page.getByLabel(/^Objet/).fill("{{prenom}}, Les Nuits en Commun reviennent");
    await page
      .getByLabel(/^Corps/)
      .fill(
        `# Bonjour {{prenom}}\n\nLes Nuits en Commun reviennent. **Trois scènes**, une équipe, et vous.\n\n> [Voir le programme](http://localhost:3000/${slug})`,
      );
    await page.getByRole("button", { name: "Créer le brouillon" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Les Nuits reviennent");
    campaignUrl = page.url();
    await expect(page.getByText("Objet :").locator("..")).toContainText("Prénom, Les Nuits en Commun reviennent");
    await page.getByRole("button", { name: "M'envoyer un test" }).click();
    await expect(page.getByText(`E-mail de test envoyé à ${lea.email}.`)).toBeVisible();
    expect(lastLinkTo(lea.email, /https?:\/\/\S+\/desinscription\/test/)).toContain("/desinscription/test");

    await page.getByRole("link", { name: "Vérifier et envoyer →" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vérifier avant d'envoyer");
    await expect(page.getByText("Destinataires réels").locator("..")).toContainText("1");
    await page.getByRole("button", { name: /Envoyer à 1 destinataire/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Envoyer", exact: true }).click();
    await expect(page.getByText(/Envoi lancé : 1 destinataire/)).toBeVisible();

    // The worker claims scheduled campaigns every minute.
    await expect
      .poll(
        async () => {
          await page.goto(campaignUrl);
          return (await badge(page, "Envoyée").count()) > 0;
        },
        { timeout: 180_000, intervals: [5_000] },
      )
      .toBe(true);
    await expect(page.getByText("Envoyés", { exact: true }).locator("..")).toContainText("1");
    await expect(page.getByRole("row", { name: new RegExp(noeEmail) })).toContainText("Envoyé");
    await expect(page.getByText(/Attribution incomplète par construction/)).toBeVisible();
    await expect(page.getByText(`http://localhost:3000/${slug}`, { exact: true })).toBeVisible();
  });

  test("Noé suit le lien (redirection avec paramètres de source) puis se désinscrit sans connexion", async ({
    page,
  }) => {
    await page.context().clearCookies();
    const tracked = lastLinkTo(noeEmail, /http:\/\/localhost:3000\/l\/[A-Za-z0-9_-]+\?r=[^\s)]+/);
    await page.goto(tracked);
    await expect(page).toHaveURL(new RegExp(`/${slug}\\?.*utm_campaign=les-nuits-reviennent.*kc=`));
    const unsubscribe = lastLinkTo(noeEmail, /http:\/\/localhost:3000\/desinscription\/[^\s)"]+/);
    await page.goto(unsubscribe);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ne plus recevoir ces e-mails ?");
    await expect(page.getByText(noeEmail).first()).toBeVisible();
    await page.getByRole("button", { name: "Me désinscrire" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vous êtes désinscrit·e.");
    await page.goto("/desinscription/forged-reference.value");
    await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Ne plus recevoir");

    await signIn(page, lea.email, new URL(campaignUrl).pathname);
    await expect(page.getByText(/1 désinscription\(s\)/)).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(noeEmail) })).toContainText("Désinscrit·e");
    await page.goto(`/o/${slug}/contacts`);
    await expect(page.getByRole("row", { name: new RegExp(noeEmail) })).toContainText("Exclu·e");
    await page.goto(`/o/${slug}/contacts/exclusions`);
    await expect(page.getByRole("row", { name: new RegExp(noeEmail) })).toContainText("Désinscription");
  });
});
