import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 2 journey in the browser:
 * création d'organisation → lieu → brouillon d'événement (check-list incomplète) → correction →
 * publication → page publique (26/27) → brouillon invisible (404) → annulation visible publiquement →
 * invitation limitée à un événement : la personne ne voit que celui-là.
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const lea = { name: "Léa Martin", email: `lea-${run}@e2e.kroov.local` };
const malik = { name: "Malik Ben", email: `malik-${run}@e2e.kroov.local` };
const orgName = `Nuits Électriques ${run}`;
const slug = `nuits-${run}`;
const eventTitle = `Grande Nuit ${run}`;
const eventSlug = `grande-nuit-${run}`;
const draftTitle = `Brouillon secret ${run}`;
const draftSlug = `brouillon-secret-${run}`;

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

async function navTo(page: Page, name: string | RegExp) {
  const opener = page.getByRole("button", { name: "Ouvrir la navigation" });
  if (await opener.isVisible()) await opener.click();
  await page.getByRole("link", { name }).click();
}

async function fillEvent(
  page: Page,
  title: string,
  slugValue: string,
  opts: { description?: string; capacity?: string },
) {
  await page.getByLabel(/^Titre/).fill(title);
  await page.getByLabel(/Identifiant d'adresse/).fill(slugValue);
  if (opts.description) await page.getByLabel(/^Description/).fill(opts.description);
  await page.getByLabel(/Date de début/).fill(dateInDays(14));
  await page.getByLabel(/Heure de début/).fill("21:00");
  await page.getByLabel(/Date de fin/).fill(dateInDays(15));
  await page.getByLabel(/Heure de fin/).fill("03:00");
  await page.getByLabel(/Ouverture des portes/).fill("20:00");
  if (opts.capacity) await page.getByLabel(/^Capacité/).fill(opts.capacity);
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 2 — événements", () => {
  test("Léa crée son organisation, un lieu et un brouillon incomplet", async ({ page, baseURL }) => {
    await signUpAndVerify(page, baseURL!, lea, "/organisations/nouvelle");
    await signIn(page, lea.email, "/organisations/nouvelle");
    await page.getByLabel(/^Nom/).fill(orgName);
    await page.getByLabel(/Identifiant d'adresse/).fill(slug);
    await page.getByRole("button", { name: /Créer l'organisation/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
    // Overview with no event: honest empty state and the create CTA.
    await expect(page.getByText("Aucun événement publié à venir")).toBeVisible();

    await navTo(page, "Événements");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos événements");
    await expect(page.getByText("Aucun événement pour le moment")).toBeVisible();
    await page.getByRole("link", { name: "Lieux" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos lieux");
    await page.getByLabel(/Nom du lieu/).fill("Hangar 21");
    await page.getByLabel(/^Adresse/).fill("21 quai des Docks");
    await page.getByLabel(/Code postal/).fill("75019");
    await page.getByLabel(/^Ville/).fill("Paris");
    await page.getByRole("button", { name: "Ajouter le lieu" }).click();
    await expect(page.getByText("Hangar 21").first()).toBeVisible();

    await navTo(page, "Événements");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos événements");
    await expect(page.getByText("Aucun événement pour le moment")).toBeVisible();
    await page
      .getByRole("link", { name: /Créer un événement/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Créer un événement");
    await fillEvent(page, eventTitle, eventSlug, { description: "Trop court" });
    await page.getByRole("button", { name: "Créer l'événement" }).click();

    // Pilot page: draft, checklist shows what is missing, publish button leads to the review page.
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/evenements/${eventSlug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(eventTitle);
    await expect(page.getByText("Brouillon").first()).toBeVisible();
    const checklist = page.getByRole("heading", { name: "Check-list de publication" }).locator("..");
    await expect(checklist).toContainText("À faire : Description de l'événement");
    await expect(checklist).toContainText("À faire : Lieu défini");
    await expect(checklist).toContainText("À faire : Capacité supérieure à zéro");
    await expect(checklist).toContainText("3 point(s) à compléter");

    await page.getByRole("link", { name: /Publier/ }).click();
    await expect(page.getByText("Publication impossible pour l'instant")).toBeVisible();
    await expect(page.getByRole("button", { name: /Publier l'événement/ })).toBeDisabled();

    // The public page does not exist yet.
    const res = await page.request.get(`/${slug}/${eventSlug}`);
    expect(res.status()).toBe(404);
  });

  test("Léa complète l'événement, le publie et la page publique apparaît", async ({ page }) => {
    await signIn(page, lea.email, `/o/${slug}/evenements/${eventSlug}/modifier`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(eventTitle);
    await page
      .getByLabel(/^Description/)
      .fill("Une nuit entière de musique électronique dans le Hangar 21, avec trois scènes et un espace calme.");
    await page.getByLabel(/^Lieu/).selectOption({ label: "Hangar 21 · Paris" });
    await page.getByLabel(/^Capacité/).fill("800");
    await page.getByLabel(/^Programme/).fill("21h — ouverture\n23h — tête d'affiche\n02h — closing");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/evenements/${eventSlug}\\?enregistre=1$`));
    await expect(page.getByText("Modifications enregistrées")).toBeVisible();
    await expect(page.getByText("Tout est prêt pour la publication")).toBeVisible();

    await page.getByRole("link", { name: /Publier/ }).click();
    await expect(page.getByText("Tout est prêt")).toBeVisible();
    await page.getByRole("button", { name: /Publier l'événement/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/evenements/${eventSlug}\\?publie=1$`));
    await expect(page.getByText("Événement publié")).toBeVisible();
    await expect(page.getByText("Publié").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Copier le lien" })).toBeVisible();

    // The overview now shows the next event.
    await navTo(page, "Vue d'ensemble");
    await expect(page.getByRole("link", { name: /Gérer l'événement/ })).toBeVisible();
    await expect(page.getByText("Événements publiés").locator("..")).toContainText("1");

    // Public pages 26 and 27 (anonymous context).
    await page.context().clearCookies();
    await page.goto(`/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Les prochaines dates");
    await page.getByRole("link", { name: new RegExp(eventTitle) }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/${eventSlug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(eventTitle);
    await expect(page.getByText("Se termine le lendemain")).toBeVisible();
    await expect(page.getByText("Ouverture des portes à 20:00")).toBeVisible();
    await expect(page.getByText("Hangar 21").first()).toBeVisible();
    await expect(page.getByText("tête d'affiche")).toBeVisible();
    await expect(page.getByText("La réservation en ligne ouvrira prochainement")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test("un brouillon n'apparaît jamais en public ; une invitation limitée à un événement ne montre que lui", async ({
    page,
    baseURL,
  }) => {
    await signIn(page, lea.email, `/o/${slug}/evenements/nouveau`);
    await fillEvent(page, draftTitle, draftSlug, {});
    await page.getByRole("button", { name: "Créer l'événement" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/evenements/${draftSlug}$`));

    // Public: listing ignores the draft, direct URL is a French 404.
    const direct = await page.request.get(`/${slug}/${draftSlug}`);
    expect(direct.status()).toBe(404);
    const listing = await page.request.get(`/${slug}`);
    expect(await listing.text()).not.toContain(draftTitle);

    // Invite Malik as event manager on the published event only.
    await page.goto(`/o/${slug}/equipe`);
    await page.getByLabel(/Adresse e-mail/).fill(malik.email);
    await page.getByLabel(/^Rôle/).selectOption("event_manager");
    await page.getByLabel(/Périmètre/).selectOption({ label: `Événement · ${eventTitle}` });
    await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
    await expect(page.getByText(`Invitation envoyée à ${malik.email}`)).toBeVisible();

    const link = onBase(lastLinkTo(malik.email, /https?:\/\/\S+\/invitation\/[A-Za-z0-9_-]+/), baseURL!);
    await page.context().clearCookies();
    await signUpAndVerify(page, baseURL!, malik, new URL(link).pathname);
    await signIn(page, malik.email, new URL(link).pathname);
    await expect(page.getByText(eventTitle)).toBeVisible(); // the invitation names its scope
    await page.getByRole("button", { name: /Rejoindre/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}\\?bienvenue=1$`));

    await navTo(page, "Événements");
    await expect(page.getByText(eventTitle).first()).toBeVisible();
    await expect(page.getByText(draftTitle)).toHaveCount(0);
    // Direct access to the other event is a 404; creation is not offered.
    await page.goto(`/o/${slug}/evenements/${draftSlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cette page n'existe pas");
    await page.goto(`/o/${slug}/evenements/nouveau`);
    await expect(page.getByText("Vous n'avez pas accès à cet espace")).toBeVisible();
  });

  test("Léa annule l'événement : la page publique l'annonce sans disparaître", async ({ page }) => {
    await signIn(page, lea.email, `/o/${slug}/evenements/${eventSlug}`);
    // The pilot page never overflows horizontally (long URLs and titles wrap or truncate).
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(
      false,
    );
    await page.getByRole("button", { name: "Annuler l'événement" }).click();
    await page.getByLabel(/^Motif/).fill("Intempéries annoncées sur le quai.");
    await page.getByRole("button", { name: "Confirmer l'annulation" }).click();
    await expect(page.getByText("Événement annulé").first()).toBeVisible();

    await page.context().clearCookies();
    await page.goto(`/${slug}/${eventSlug}`);
    await expect(page.getByText("Événement annulé")).toBeVisible();
    await expect(page.getByText("Intempéries annoncées")).toBeVisible();
    await expect(page.getByText("Cet événement n'est plus ouvert")).toBeVisible();
  });
});
