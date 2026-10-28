import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 4 journey in the browser:
 * organisation + compte de paiement (simulé) → formule payante sur revue + formule gratuite →
 * page publique « adhérer » → demande de Mia (sans compte) → Léa approuve → Mia paie (simulé) →
 * carte d'adhérent active → tarif réservé aux adhérents : refusé sans adhésion, accepté avec →
 * suspension puis réactivation → adhésion gratuite activée immédiatement.
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const lea = { name: "Léa Martin", email: `lea-m-${run}@e2e.kroov.local` };
const orgName = `Collectif Lumière ${run}`;
const slug = `lumiere-${run}`;
const eventTitle = `Soirée adhérents ${run}`;
const eventSlug = `soiree-adherents-${run}`;
const miaEmail = `mia-${run}@e2e.kroov.local`;
const noeEmail = `noe-${run}@e2e.kroov.local`;

function dateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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

let cardUrl = "";
let membershipPath = "";

test.describe("Phase 4 — adhésions", () => {
  test("Léa crée deux formules et un tarif réservé aux adhérents", async ({ page, baseURL }) => {
    await signUpAndVerify(page, baseURL!, lea, "/organisations/nouvelle");
    await signIn(page, lea.email, "/organisations/nouvelle");
    await page.getByLabel(/^Nom/).fill(orgName);
    await page.getByLabel(/Identifiant d'adresse/).fill(slug);
    await page.getByRole("button", { name: /Créer l'organisation/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
    await page.goto(`/o/${slug}/parametres`);
    await page.getByRole("button", { name: /Connecter un compte \(simulé\)/ }).click();
    await expect(page.getByText("Encaissements actifs")).toBeVisible();

    // Section (17): empty state.
    await page.goto(`/o/${slug}/adhesions`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("On fait collectif.");
    await expect(page.getByText("Aucune adhésion")).toBeVisible();

    // Paid plan with review (18): live preview reflects the price.
    await page.getByRole("link", { name: "Nouvelle formule" }).click();
    await page.getByLabel(/^Nom\b/).fill("Adhésion annuelle");
    await page.getByLabel(/^Montant/).fill("20,00");
    await page.getByLabel(/^Période/).selectOption("rolling");
    await page.getByLabel(/Durée \(mois\)/).fill("12");
    await page.getByLabel(/^Avantages/).fill("Tarif adhérent sur les soirées\nVote à l'assemblée");
    await page.getByLabel(/Revue des demandes/).check();
    await expect(page.getByText("Aperçu public").locator("..")).toContainText("20,00 €");
    await expect(page.getByText("✓ Vote à l'assemblée")).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer la formule" }).click();
    await expect(page).toHaveURL(/\/adhesions\/formules\/[0-9a-f-]+\?cree=1/);
    await expect(page.getByText("Formule créée")).toBeVisible();

    // Free plan, immediate activation.
    await page.goto(`/o/${slug}/adhesions/formules/nouvelle`);
    await page.getByLabel(/^Nom\b/).fill("Sympathisant");
    await page.getByLabel(/^Montant/).fill("0");
    await page.getByLabel(/Début de validité/).fill(dateInDays(-1));
    await page.getByLabel(/Fin de validité/).fill(dateInDays(200));
    await page.getByRole("button", { name: "Enregistrer la formule" }).click();
    await expect(page.getByText("Formule créée")).toBeVisible();
    await page.goto(`/o/${slug}/adhesions?onglet=formules`);
    await expect(page.getByRole("cell", { name: /Adhésion annuelle/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Sympathisant/ })).toBeVisible();

    // Venue + event + members-only ticket type.
    await page.goto(`/o/${slug}/lieux`);
    await page.getByLabel(/Nom du lieu/).fill("Maison du collectif");
    await page.getByLabel(/^Ville/).fill("Lyon");
    await page.getByRole("button", { name: "Ajouter le lieu" }).click();
    await expect(page.getByText("Maison du collectif").first()).toBeVisible();
    await page.goto(`/o/${slug}/evenements/nouveau`);
    await page.getByLabel(/^Titre/).fill(eventTitle);
    await page.getByLabel(/Identifiant d'adresse/).fill(eventSlug);
    await page
      .getByLabel(/^Description/)
      .fill("Une soirée réservée aux adhérents du collectif, avec un tarif qui n'existe que pour eux.");
    await page.getByLabel(/Date de début/).fill(dateInDays(21));
    await page.getByLabel(/Heure de début/).fill("20:00");
    await page.getByLabel(/Date de fin/).fill(dateInDays(21));
    await page.getByLabel(/Heure de fin/).fill("23:30");
    await page.getByLabel(/^Lieu/).selectOption({ label: "Maison du collectif · Lyon" });
    await page.getByLabel(/^Capacité/).fill("80");
    await page.getByRole("button", { name: "Créer l'événement" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/evenements/${eventSlug}$`));
    await page.getByRole("link", { name: /Publier/ }).click();
    await page.getByRole("button", { name: /Publier l'événement/ }).click();
    await expect(page.getByText("Événement publié")).toBeVisible();
    await page.getByRole("link", { name: "Configurer les billets" }).click();
    await page.getByRole("button", { name: /Ajouter un tarif/ }).click();
    await page.getByLabel(/Nom du tarif/).fill("Tarif adhérent");
    await page.getByLabel(/Prix public/).fill("8,00");
    await page.getByLabel(/^Quota/).fill("40");
    await page.getByLabel(/Réservé aux adhérents/).check();
    await page.getByRole("button", { name: "Ajouter le tarif" }).click();
    await expect(page.getByRole("cell", { name: /Tarif adhérent/ })).toContainText("Adhérents");
    await page.getByRole("button", { name: /Ouvrir les ventes/ }).click();
    await expect(page.getByText("Ventes ouvertes")).toBeVisible();
  });

  test("Mia demande l'adhésion annuelle sans compte ; sa demande attend la revue", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`/${slug}/adherer`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/On fait\s*collectif/);
    await expect(page.getByText("Demande examinée par l'organisation avant activation.")).toBeVisible();
    await expect(page.getByText("+ 0,80 € de frais de service")).toBeVisible();
    await page.getByText("Adhésion annuelle", { exact: true }).click();
    await page.getByLabel(/^Prénom/).fill("Mia");
    await page.getByLabel(/^Nom/).fill("Lefèvre");
    await page.getByLabel(/^E-mail/).fill(miaEmail);
    await page.getByRole("button", { name: /Envoyer ma demande/ }).click();
    await expect(page).toHaveURL(/\/adhesion\/[0-9a-f-]+\?k=.*nouveau=1/);
    cardUrl = page.url();
    membershipPath = new URL(cardUrl).pathname;
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Demande\s*bien reçue/);
    await expect(page.getByText("À examiner")).toBeVisible();
    // Follow-up link by e-mail; without the token the page is not found.
    expect(lastLinkTo(miaEmail, /https?:\/\/\S+\/adhesion\/\S+/)).toContain("/adhesion/");
    const res = await page.request.get(membershipPath);
    expect(res.status()).toBe(404);
    // Members-only ticket is refused: not a member yet.
    await page.goto(`/${slug}/${eventSlug}/billets`);
    await expect(page.getByText("Réservé aux adhérents")).toBeVisible();
    await page.getByRole("button", { name: "Ajouter un billet" }).click();
    await page.getByLabel(/E-mail de votre adhésion/).fill(miaEmail);
    await page.getByRole("button", { name: /Continuer/ }).click();
    await expect(page.getByText(/adhésion active/i)).toBeVisible();
  });

  test("Léa approuve ; Mia règle sa cotisation ; la carte devient active par webhook", async ({ page }) => {
    await signIn(page, lea.email, `/o/${slug}/adhesions`);
    await expect(page.getByText("Demandes à examiner").locator("..")).toContainText("1");
    await page.getByRole("link", { name: "Voir →" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Mia Lefèvre");
    await page.getByRole("button", { name: "Approuver" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approuver" }).click();
    await expect(page.getByText("Demande approuvée.")).toBeVisible();
    await expect(page.getByText("Paiement attendu")).toBeVisible();

    // Mia pays through the e-mail link (same signed link as the card).
    await page.context().clearCookies();
    await page.goto(cardUrl.replace("&nouveau=1", ""));
    await expect(page.getByText("Demande approuvée !")).toBeVisible();
    await expect(page.getByText("+ 0,80 € de frais de service")).toBeVisible();
    await page.getByRole("button", { name: /Régler ma cotisation · 20,80 €/ }).click();
    await expect(page).toHaveURL(/\/paiement\/cs_fake_/);
    await page.getByRole("button", { name: /^Payer 20,80 €/ }).click();
    await expect(page).toHaveURL(/\/adhesion\/[0-9a-f-]+\?k=.*nouveau=1/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Vous faites partie/, { timeout: 15_000 });
    await expect(page.getByText("Adhésion activée.")).toBeVisible();
    await expect(page.getByText(/M-\d{4}/)).toBeVisible();
    expect(lastLinkTo(miaEmail, /https?:\/\/\S+\/adhesion\/\S+/)).toContain("/adhesion/");

    // Now the members-only ticket goes through to the details step.
    await page.goto(`/${slug}/${eventSlug}/billets`);
    await page.getByRole("button", { name: "Ajouter un billet" }).click();
    await page.getByLabel(/E-mail de votre adhésion/).fill(miaEmail);
    await page.getByRole("button", { name: /Continuer/ }).click();
    await expect(page).toHaveURL(/\/commande\/[0-9a-f-]+\?k=/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("À quel nom ?");
  });

  test("Léa suspend puis réactive ; l'historique garde la trace ; Noé adhère gratuitement et est actif aussitôt", async ({
    page,
  }) => {
    await signIn(page, lea.email, `/o/${slug}/adhesions?statut=active`);
    await expect(page.getByText("Adhérents actifs").locator("..")).toContainText("1");
    await page.getByRole("link", { name: "Voir →" }).first().click();
    await page.getByRole("button", { name: "Suspendre" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/^Motif/)
      .fill("Vérification de l'adresse");
    await page.getByRole("dialog").getByRole("button", { name: "Suspendre" }).click();
    await expect(page.getByText("Adhésion suspendue.")).toBeVisible();
    await page.getByRole("button", { name: "Réactiver" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Réactiver" }).click();
    await expect(page.getByText("Adhésion réactivée.")).toBeVisible();
    await expect(page.getByText("Historique").locator("..")).toContainText("Suspension");
    await expect(page.getByText("Historique").locator("..")).toContainText("Réactivation");

    await page.context().clearCookies();
    await page.goto(`/${slug}/adherer`);
    await page.getByText("Sympathisant", { exact: true }).click();
    await page.getByLabel(/^Prénom/).fill("Noé");
    await page.getByLabel(/^Nom/).fill("Garnier");
    await page.getByLabel(/^E-mail/).fill(noeEmail);
    await page.getByRole("button", { name: /Adhérer gratuitement/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Vous faites partie/);
    await expect(page.getByText("Adhésion activée.")).toBeVisible();
    await expect(page.getByText("Gratuite")).toBeVisible();
  });
});
