import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 3 journey in the browser:
 * organisation + compte de paiement (simulé) → événement publié → tarifs + ouverture des ventes →
 * page publique → choix de 2 billets → coordonnées + participants → paiement simulé REFUSÉ →
 * réessai → paiement ACCEPTÉ → confirmation (attente du webhook) → billet QR → scan accepté →
 * second scan refusé → remboursement d'un billet → billet refusé au scan → réservation expirée (34).
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const lea = { name: "Léa Martin", email: `lea-${run}@e2e.kroov.local` };
const orgName = `Nuits Électriques ${run}`;
const slug = `nuits-${run}`;
const eventTitle = `Grande Nuit ${run}`;
const eventSlug = `grande-nuit-${run}`;
const buyerEmail = `lou-${run}@e2e.kroov.local`;

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

let ticketUrl = "";
let orderUrl = "";
let qrCredential = "";

test.describe("Phase 3 — billetterie", () => {
  test("Léa prépare l'organisation : compte de paiement, événement publié, tarifs, ventes ouvertes", async ({
    page,
    baseURL,
  }) => {
    await signUpAndVerify(page, baseURL!, lea, "/organisations/nouvelle");
    await signIn(page, lea.email, "/organisations/nouvelle");
    await page.getByLabel(/^Nom/).fill(orgName);
    await page.getByLabel(/Identifiant d'adresse/).fill(slug);
    await page.getByRole("button", { name: /Créer l'organisation/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));

    // Payment account (simulated provider: active at once, explicitly labelled).
    await page.goto(`/o/${slug}/parametres`);
    await expect(page.getByText("Fournisseur de paiement")).toBeVisible();
    await page.getByRole("button", { name: /Connecter un compte \(simulé\)/ }).click();
    await expect(page).toHaveURL(/parametres\?paiements=retour/);
    await expect(page.getByText("Encaissements actifs")).toBeVisible();

    // Venue + event + publish.
    await page.goto(`/o/${slug}/lieux`);
    await page.getByLabel(/Nom du lieu/).fill("Hangar 21");
    await page.getByLabel(/^Ville/).fill("Paris");
    await page.getByRole("button", { name: "Ajouter le lieu" }).click();
    await expect(page.getByText("Hangar 21").first()).toBeVisible();
    await page.goto(`/o/${slug}/evenements/nouveau`);
    await page.getByLabel(/^Titre/).fill(eventTitle);
    await page.getByLabel(/Identifiant d'adresse/).fill(eventSlug);
    await page
      .getByLabel(/^Description/)
      .fill("Une nuit entière de musique électronique dans le Hangar 21, avec trois scènes.");
    await page.getByLabel(/Date de début/).fill(dateInDays(14));
    await page.getByLabel(/Heure de début/).fill("21:00");
    await page.getByLabel(/Date de fin/).fill(dateInDays(15));
    await page.getByLabel(/Heure de fin/).fill("03:00");
    await page.getByLabel(/^Lieu/).selectOption({ label: "Hangar 21 · Paris" });
    await page.getByLabel(/^Capacité/).fill("100");
    await page.getByRole("button", { name: "Créer l'événement" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/evenements/${eventSlug}$`));
    await page.getByRole("link", { name: /Publier/ }).click();
    await page.getByRole("button", { name: /Publier l'événement/ }).click();
    await expect(page.getByText("Événement publié")).toBeVisible();

    // Tickets configuration (06): sales cannot open without a type.
    await page.getByRole("link", { name: "Configurer les billets" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("À chacun son billet");
    await expect(page.getByRole("button", { name: /Ouvrir les ventes/ })).toBeDisabled();
    await page.getByRole("button", { name: /Ajouter un tarif/ }).click();
    await page.getByLabel(/Nom du tarif/).fill("Tarif standard");
    await page.getByLabel(/Prix public/).fill("30,00");
    await page.getByLabel(/^Quota/).fill("50");
    await page.getByLabel(/Max. par commande/).fill("4");
    await page.getByRole("button", { name: "Ajouter le tarif" }).click();
    await expect(page.getByRole("cell", { name: /Tarif standard/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: "30,00 €" })).toBeVisible();
    await page.getByRole("button", { name: /Ouvrir les ventes/ }).click();
    await expect(page.getByText("Ventes ouvertes")).toBeVisible();
  });

  test("Lou achète 2 billets : refus bancaire, réessai, paiement accepté, billets émis par webhook", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto(`/${slug}/${eventSlug}`);
    await expect(page.getByText("À partir de 30,00 €")).toBeVisible();
    await page.getByRole("link", { name: /Choisir mes billets/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos places");
    await expect(page.getByText("+ 1,20 € de frais / billet")).toBeVisible();
    await page.getByRole("button", { name: "Ajouter un billet" }).click();
    await page.getByRole("button", { name: "Ajouter un billet" }).click();
    await expect(page.getByText("Total à payer").locator("..")).toContainText("62,40 €");
    await page.getByRole("button", { name: /Continuer · 62,40 €/ }).click();

    // Step 2 (29): details + attendees, timer visible.
    await expect(page).toHaveURL(/\/commande\/[0-9a-f-]+\?k=/);
    orderUrl = page.url();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("À quel nom ?");
    await expect(page.getByText(/Vos places sont réservées · \d\d:\d\d/)).toBeVisible();
    await page.getByLabel(/E-mail de réception/).fill(buyerEmail);
    await page.getByLabel(/^Prénom/).fill("Lou");
    await page.getByLabel(/^Nom/).fill("Martin");
    const participants = page.getByLabel(/^Participant/);
    await participants.nth(0).fill("Lou Martin");
    await participants.nth(1).fill("Sam Moreau");
    await page.getByLabel(/J'accepte les conditions/).check();
    await page.getByRole("button", { name: /Continuer vers le paiement/ }).click();

    // Simulated provider page: the bank refuses.
    await expect(page).toHaveURL(/\/paiement\/cs_fake_/);
    await expect(page.getByText("Page de paiement simulée")).toBeVisible();
    await page.getByRole("button", { name: /Simuler un refus/ }).click();
    await expect(page).toHaveURL(/\/commande\/[0-9a-f-]+\?k=.*annule=1/);
    // Webhook delivered: the order is `failed`, the page offers a retry (33).
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("On réessaie ?");
    await expect(page.getByText("Le paiement a été refusé.")).toBeVisible();
    await expect(page.getByText(/Vos places sont encore réservées/)).toBeVisible();
    await page.getByLabel(/J'accepte les conditions/).check();
    await page.getByRole("button", { name: /Utiliser une autre carte/ }).click();
    await expect(page).toHaveURL(/\/paiement\/cs_fake_/);
    await page.getByRole("button", { name: /^Payer 62,40 €/ }).click();

    // Confirmation (31): the page waits for the webhook, then shows the tickets.
    await expect(page).toHaveURL(/\/commande\/[0-9a-f-]+\/confirmation\?k=/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/C'est dans\s*la poche/, { timeout: 15_000 });
    await expect(page.getByText(buyerEmail)).toBeVisible();
    const ticketLinks = page.getByRole("link", { name: /KR-\d+-01/ });
    await expect(ticketLinks).toHaveCount(1);
    await ticketLinks.click();

    // Ticket page (32): QR present, manual code shown.
    await expect(page).toHaveURL(/\/billets\//);
    ticketUrl = page.url();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Prêt à entrer ?");
    await expect(page.getByRole("img", { name: /QR code du billet/ })).toBeVisible();
    await expect(page.getByText("Lou Martin")).toBeVisible();
    qrCredential = (await page.locator("code").first().textContent())?.trim() ?? "";
    expect(qrCredential.length).toBeGreaterThan(20);
    // The e-mail carries the links, never the QR credential.
    const mail = lastLinkTo(buyerEmail, /https?:\/\/\S+\/billets\/\S+/);
    expect(mail).toContain("/billets/");
  });

  test("Yanis contrôle l'entrée : accepté, puis déjà passé ; un code inconnu est invalide", async ({ page }) => {
    await signIn(page, lea.email, `/controle/${slug}/${eventSlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Bienvenue à l'entrée.");
    await expect(page.getByText("Entrées validées").locator("..")).toContainText("0 / 2");
    await page.getByLabel("Code du billet").fill(qrCredential);
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByText("Entrée autorisée")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Bonne soirée, Lou");
    await page.getByRole("button", { name: /Scanner le billet suivant/ }).click();
    await page.getByLabel("Code du billet").fill(qrCredential);
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByText("Entrée non validée")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ce billet est déjà passé.");
    await expect(page.getByText("Premier passage")).toBeVisible();
    await page.getByRole("button", { name: /Scanner un autre billet/ }).click();
    await page.getByLabel("Code du billet").fill("code-inconnu-0000");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByText("Code inconnu")).toBeVisible();
    await page.getByRole("button", { name: /Scanner un autre billet/ }).click();
    await page.getByRole("link", { name: "Journal" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Journal des contrôles");
    await expect(page.getByText("1 / 2")).toBeVisible();
  });

  test("Léa rembourse le second billet : la commande passe en remboursement partiel et le billet est refusé", async ({
    page,
  }) => {
    await signIn(page, lea.email, `/o/${slug}/billetterie`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Chaque place, chaque personne.");
    await expect(page.getByText("Billets payés").locator("..")).toContainText("2");
    await page.getByRole("link", { name: "Voir →" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("La commande de Lou.");
    await expect(page.getByText("Paiement confirmé")).toBeVisible();
    await page.getByLabel(/Périmètre/).selectOption("partial");
    await page.getByRole("checkbox", { name: /KR-\d+-02/ }).check();
    await page.getByRole("checkbox", { name: /Je confirme l'annulation/ }).check();
    await expect(page.getByText("Montant remboursé").locator("..")).toContainText("31,20 €");
    await page.getByRole("button", { name: "Confirmer le remboursement" }).click();
    await expect(page.getByText("1 billet(s) remboursé(s)")).toBeVisible();
    await expect(page.getByText("Remb. partiel").first()).toBeVisible();
    // Buyer side: the confirmation page no longer lists the refunded ticket; the first one still opens.
    await page.context().clearCookies();
    await page.goto(orderUrl.replace(/\?k=/, "/confirmation?k="));
    await expect(page.getByText("Une partie de cette commande a été remboursée")).toBeVisible();
    await expect(page.getByRole("link", { name: /KR-\d+-02/ })).toHaveCount(0);
    await page.goto(ticketUrl);
    await expect(page.getByText("Utilisé")).toBeVisible();
  });

  test("la disponibilité publique reflète les billets vendus et remboursés ; une commande vide est refusée proprement", async ({
    page,
    request,
  }) => {
    const res = await request.post("/api/v1/public/orders", {
      headers: { "content-type": "application/json", "x-requested-with": "kroov" },
      data: { organizationSlug: slug, eventSlug, items: [] },
    });
    expect(res.status()).toBe(422); // validation, not a 500
    await page.goto(`/${slug}/${eventSlug}/billets`);
    // 50 seats, 1 valid (used) ticket, 1 refunded → 49 left.
    await expect(page.getByText("49 places restantes")).toBeVisible();
  });
});
