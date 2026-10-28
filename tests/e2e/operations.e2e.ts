import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 9 journey in the browser (the test server runs the worker too):
 * organisation + paiement simulé + événement publié + tarif → Lou achète 2 billets → la vue d'ensemble et
 * le bloc « Chiffres » montrent les vrais chiffres → Finances (grand livre, journal, export CSV) →
 * tâche créée (en retard) puis terminée → remboursement d'un billet → le worker relaie l'événement de
 * domaine → notification visible (cloche) puis lue → rapport d'événement exporté.
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const lea = { name: "Léa Martin", email: `lea-o-${run}@e2e.kroov.local` };
const orgName = `Collectif Opérations ${run}`;
const slug = `operations-${run}`;
const eventTitle = `Nuit des Chiffres ${run}`;
const eventSlug = `nuit-chiffres-${run}`;
const buyerEmail = `lou-o-${run}@e2e.kroov.local`;

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

let organizationId = "";

test.describe("Phase 9 — opérations", () => {
  test("Léa prépare l'organisation : paiement simulé, événement publié, tarif, ventes ouvertes", async ({
    page,
    baseURL,
  }) => {
    await signUpAndVerify(page, baseURL!, lea, "/organisations/nouvelle");
    await signIn(page, lea.email, "/organisations/nouvelle");
    await page.getByLabel(/^Nom/).fill(orgName);
    await page.getByLabel(/Identifiant d'adresse/).fill(slug);
    await page.getByRole("button", { name: /Créer l'organisation/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
    // Before any sale: real zeros from the records, never placeholders, and the bell is quiet.
    await expect(page.getByText("Billets vendus").locator("..")).toContainText("0");
    await expect(page.getByTestId("notifications-bell")).toHaveAttribute("aria-label", "Notifications");
    await page.goto(`/o/${slug}/parametres`);
    await page.getByRole("button", { name: /Connecter un compte \(simulé\)/ }).click();
    await expect(page.getByText("Encaissements actifs")).toBeVisible();
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
      .fill("Une nuit entière de musique dans le Hangar 21, avec trois scènes et des chiffres justes.");
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
    await page.getByRole("link", { name: "Configurer les billets" }).click();
    await page.getByRole("button", { name: /Ajouter un tarif/ }).click();
    await page.getByLabel(/Nom du tarif/).fill("Tarif standard");
    await page.getByLabel(/Prix public/).fill("30,00");
    await page.getByLabel(/^Quota/).fill("50");
    await page.getByLabel(/Max. par commande/).fill("4");
    await page.getByRole("button", { name: "Ajouter le tarif" }).click();
    await expect(page.getByRole("cell", { name: /Tarif standard/ })).toBeVisible();
    await page.getByRole("button", { name: /Ouvrir les ventes/ }).click();
    await expect(page.getByText("Ventes ouvertes")).toBeVisible();
    const mine = await page.request.get("/api/v1/organizations");
    const orgs = (await mine.json()) as { data: Array<{ id: string; slug: string }> };
    organizationId = orgs.data.find((o) => o.slug === slug)?.id ?? "";
    expect(organizationId).not.toBe("");
  });

  test("Lou achète 2 billets ; les chiffres de Léa suivent (vue d'ensemble, événement, finances, export)", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto(`/${slug}/${eventSlug}`);
    await page.getByRole("link", { name: /Choisir mes billets/ }).click();
    await page.getByRole("button", { name: "Ajouter un billet" }).click();
    await page.getByRole("button", { name: "Ajouter un billet" }).click();
    await page.getByRole("button", { name: /Continuer · 62,40 €/ }).click();
    await page.getByLabel(/E-mail de réception/).fill(buyerEmail);
    await page.getByLabel(/^Prénom/).fill("Lou");
    await page.getByLabel(/^Nom/).fill("Martin");
    const participants = page.getByLabel(/^Participant/);
    await participants.nth(0).fill("Lou Martin");
    await participants.nth(1).fill("Sam Moreau");
    await page.getByLabel(/J'accepte les conditions/).check();
    await page.getByRole("button", { name: /Continuer vers le paiement/ }).click();
    await expect(page).toHaveURL(/\/paiement\/cs_fake_/);
    await page.getByRole("button", { name: /^Payer 62,40 €/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/C'est dans\s*la poche/, { timeout: 15_000 });

    // Overview (03): KPIs come from tickets, orders and the ledger.
    await signIn(page, lea.email, `/o/${slug}`);
    await expect(page.getByText("Billets vendus").locator("..")).toContainText("2");
    await expect(page.getByText("Brut billetterie").locator("..")).toContainText("60,00 €");
    // Event pilotage: « Chiffres » block with occupancy and sources, report export.
    await page.goto(`/o/${slug}/evenements/${eventSlug}`);
    await expect(page.getByRole("heading", { name: "Chiffres", exact: true })).toBeVisible();
    await expect(page.getByText("Remplissage", { exact: true }).locator("..")).toContainText("2 %");
    await expect(page.getByText("Net estimé", { exact: true }).locator("..")).toContainText("60,00 €");
    await expect(page.getByText("Tarif standard", { exact: true }).locator("..")).toContainText("2 / 50");
    const reportHref = await page.getByRole("link", { name: "Rapport (CSV)" }).getAttribute("href");
    const report = await page.request.get(reportHref ?? "");
    expect(report.status()).toBe(200);
    expect(await report.text()).toContain("billetterie;billets_vendus;2;");
    // Finances (22): ledger balances, journal entries, explicit payouts note, CSV export.
    await page.goto(`/o/${slug}/finances`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Les comptes, sans approximation.");
    await expect(page.getByText("Brut billetterie", { exact: true }).locator("..")).toContainText("60,00 €");
    await expect(page.getByText("Frais de plateforme", { exact: true }).locator("..")).toContainText("2,40 €");
    await expect(page.getByText(/Versements/)).toBeVisible();
    await expect(page.getByText("Encaissé par le prestataire à ce jour :").locator("..")).toContainText("62,40 €");
    await expect(page.getByRole("cell", { name: "Commande payée" })).toBeVisible();
    const journal = await page.request.get(`/api/v1/organizations/${organizationId}/finances/export`);
    expect(journal.status()).toBe(200);
    expect(journal.headers()["content-type"]).toContain("text/csv");
    expect(await journal.text()).toContain(";revenue_tickets;EUR;C;60.00");
  });

  test("Léa crée une tâche en retard, la voit sur la vue d'ensemble, puis la termine", async ({ page }) => {
    await signIn(page, lea.email, `/o/${slug}/taches`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ce qui reste à faire.");
    await page.getByRole("button", { name: "+ Nouvelle tâche" }).click();
    await page.getByLabel(/^Titre/).fill("Commander les gobelets");
    await page.getByLabel(/^Priorité/).selectOption("high");
    await page.getByLabel(/^Échéance/).fill("2020-01-01T10:00");
    const assignee = page.getByLabel(/^Responsable/);
    await assignee.selectOption((await assignee.locator("option", { hasText: lea.name }).getAttribute("value")) ?? "");
    await page.getByRole("button", { name: "Créer la tâche" }).click();
    await expect(page.getByText("Commander les gobelets")).toBeVisible();
    await expect(page.getByText(/En retard · /)).toBeVisible();
    await expect(page.getByText("échéance dépassée").locator("..")).toContainText("1");
    await page.goto(`/o/${slug}`);
    await expect(page.getByText("Tâches en retard").locator("..")).toContainText("1");
    await expect(page.getByRole("heading", { name: "À faire aujourd'hui" })).toBeVisible();
    await expect(page.getByText("Commander les gobelets")).toBeVisible();
    await page.goto(`/o/${slug}/taches`);
    await page.getByRole("button", { name: "Terminer : Commander les gobelets" }).click();
    await expect(page.getByText("Rien d'ouvert")).toBeVisible();
    await page.goto(`/o/${slug}/taches?filtre=done`);
    await expect(page.getByRole("button", { name: "Rouvrir : Commander les gobelets" })).toBeVisible();
    const csv = await page.request.get(`/api/v1/organizations/${organizationId}/tasks/export`);
    expect(await csv.text()).toContain("Commander les gobelets;Terminée;Haute;");
  });

  test("un remboursement crée une notification via le worker ; Léa la lit depuis la cloche", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, lea.email, `/o/${slug}/billetterie`);
    await page.getByRole("link", { name: "Voir →" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("La commande de Lou.");
    await page.getByLabel(/Périmètre/).selectOption("partial");
    await page.getByRole("checkbox", { name: /KR-\d+-02/ }).check();
    await page.getByRole("checkbox", { name: /Je confirme l'annulation/ }).check();
    await page.getByRole("button", { name: "Confirmer le remboursement" }).click();
    await expect(page.getByText("1 billet(s) remboursé(s)")).toBeVisible();

    // The outbox relay runs every minute, the consumer right after: the bell shows the unread count.
    await expect
      .poll(
        async () => {
          await page.goto(`/o/${slug}`);
          return page.getByTestId("notifications-bell").getAttribute("aria-label");
        },
        { timeout: 180_000, intervals: [5_000] },
      )
      .toContain("1 non lue(s)");
    await expect(page.getByText("Brut billetterie").locator("..")).toContainText("31,20 € remboursé(s)");
    await page.getByTestId("notifications-bell").click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos notifications.");
    await expect(page.getByText(/Remboursement effectué : commande KR-/)).toBeVisible();
    await expect(page.getByText("31,20 € remboursé(s).")).toBeVisible();
    await page.getByRole("button", { name: /Marquer comme lue : Remboursement effectué/ }).click();
    await expect(page.getByText("Tout est lu.")).toBeVisible();
    await expect(page.getByTestId("notifications-bell")).toHaveAttribute("aria-label", "Notifications");
    // Preferences are per member and saved.
    await page.getByLabel(/Campagne terminée/).uncheck();
    await page.getByRole("button", { name: "Enregistrer mes préférences" }).click();
    await expect(page.getByText("Préférences enregistrées.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Campagne terminée/)).not.toBeChecked();
  });
});
