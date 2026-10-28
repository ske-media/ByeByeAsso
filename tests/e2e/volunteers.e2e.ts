import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 5 journey in the browser:
 * organisation → compétences, équipe, postes (SST obligatoire sur le poste de secours) → événement publié →
 * postes activés + créneaux + question → recrutement ouvert → Maya candidate en deux étapes (vœux ordonnés,
 * disponibilités, binôme Sam) → suivi → Nora examine : vérifie le SST, accepte → Maya voit « Acceptée » →
 * Sam candidate en nommant Maya → binôme réciproque → liste d'attente → Sam retire sa candidature.
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const lea = { name: "Léa Martin", email: `lea-v-${run}@e2e.kroov.local` };
const orgName = `Collectif Lumière ${run}`;
const slug = `benevoles-${run}`;
const eventTitle = `Nuit des bénévoles ${run}`;
const eventSlug = `nuit-benevoles-${run}`;
const mayaEmail = `maya-${run}@e2e.kroov.local`;
const samEmail = `sam-${run}@e2e.kroov.local`;

function dateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const eventDay = dateInDays(21);
const eventNextDay = dateInDays(22);

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

let trackingUrl = "";

/** A status badge renders "•" + label: match the whole badge text. */
const badge = (page: Page, label: string) =>
  page.getByText(new RegExp(`^•?\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));

test.describe("Phase 5 — bénévoles", () => {
  test("Léa crée compétences, équipe, postes, créneaux et ouvre le recrutement", async ({ page, baseURL }) => {
    await signUpAndVerify(page, baseURL!, lea, "/organisations/nouvelle");
    await signIn(page, lea.email, "/organisations/nouvelle");
    await page.getByLabel(/^Nom/).fill(orgName);
    await page.getByLabel(/Identifiant d'adresse/).fill(slug);
    await page.getByRole("button", { name: /Créer l'organisation/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));

    // Skills (11, onglet compétences).
    await page.goto(`/o/${slug}/benevoles?onglet=competences`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Des mains et des cœurs.");
    await page.getByRole("button", { name: /Ajouter une compétence/ }).click();
    await page.getByLabel(/Nom de la compétence/).fill("Service au bar");
    await page.getByRole("button", { name: "Ajouter la compétence" }).click();
    await expect(page.getByText("Service au bar", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Ajouter une compétence/ }).click();
    await page.getByLabel(/Nom de la compétence/).fill("SST");
    await page.getByLabel(/Vérification requise/).check();
    await page.getByRole("button", { name: "Ajouter la compétence" }).click();
    await expect(page.getByText("SST", { exact: true })).toBeVisible();
    await expect(page.getByText("À vérifier", { exact: true })).toBeVisible();

    // Team + positions.
    await page.goto(`/o/${slug}/benevoles?onglet=equipes`);
    await page.getByRole("button", { name: /Nouvelle équipe/ }).click();
    await page.getByLabel(/Nom de l'équipe/).fill("Bar");
    await page.getByRole("button", { name: "Créer l'équipe" }).click();
    await expect(page.getByRole("heading", { level: 3, name: /Bar/ })).toBeVisible();
    await page.getByRole("button", { name: /Nouveau poste/ }).click();
    await page.getByLabel(/Nom du poste/).fill("Bar principal");
    await page.getByRole("button", { name: "Créer le poste" }).click();
    await expect(page.getByText("Bar principal", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Nouveau poste/ }).click();
    await page.getByLabel(/Nom du poste/).fill("Poste de secours");
    await page.getByRole("dialog").locator("li", { hasText: "SST" }).getByLabel("Obligatoire").check();
    await page.getByRole("button", { name: "Créer le poste" }).click();
    await expect(page.getByText("SST (obligatoire)")).toBeVisible();

    // Event + publish.
    await page.goto(`/o/${slug}/lieux`);
    await page.getByLabel(/Nom du lieu/).fill("Le Sucre");
    await page.getByLabel(/^Ville/).fill("Lyon");
    await page.getByRole("button", { name: "Ajouter le lieu" }).click();
    await expect(page.getByText("Le Sucre").first()).toBeVisible();
    await page.goto(`/o/${slug}/evenements/nouveau`);
    await page.getByLabel(/^Titre/).fill(eventTitle);
    await page.getByLabel(/Identifiant d'adresse/).fill(eventSlug);
    await page
      .getByLabel(/^Description/)
      .fill("Une nuit entière à faire tourner le bar, l'accueil et le poste de secours.");
    await page.getByLabel(/Date de début/).fill(eventDay);
    await page.getByLabel(/Heure de début/).fill("18:00");
    await page.getByLabel(/Date de fin/).fill(eventNextDay);
    await page.getByLabel(/Heure de fin/).fill("02:00");
    await page.getByLabel(/^Lieu/).selectOption({ label: "Le Sucre · Lyon" });
    await page.getByLabel(/^Capacité/).fill("300");
    await page.getByRole("button", { name: "Créer l'événement" }).click();
    await page.getByRole("link", { name: /Publier/ }).click();
    await page.getByRole("button", { name: /Publier l'événement/ }).click();
    await expect(page.getByText("Événement publié")).toBeVisible();

    // Staffing (13): activate positions, shifts, question, open.
    await page.goto(`/o/${slug}/evenements/${eventSlug}/benevoles`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Postes et besoins.");
    await expect(page.getByRole("button", { name: "Ouvrir le recrutement" })).toBeDisabled();
    await page.getByLabel(/Activer un poste type/).selectOption({ label: "Bar principal · Bar" });
    await page.getByRole("button", { name: "Activer", exact: true }).click();
    await expect(page.getByRole("heading", { level: 3, name: /Bar principal/ })).toBeVisible();
    await page.getByLabel(/Activer un poste type/).selectOption({ label: "Poste de secours · Bar" });
    await page.getByRole("button", { name: "Activer", exact: true }).click();
    await expect(page.getByRole("heading", { level: 3, name: /Poste de secours/ })).toBeVisible();
    await page
      .getByRole("button", { name: /\+ Créneau/ })
      .first()
      .click();
    await page.getByLabel(/^Libellé/).fill("Ouverture");
    await page.getByLabel(/Début \(date\)/).fill(eventDay);
    await page.getByLabel(/Début \(heure\)/).fill("17:00");
    await page.getByLabel(/Fin \(date\)/).fill(eventDay);
    await page.getByLabel(/Fin \(heure\)/).fill("23:00");
    await page.getByLabel(/Effectif requis/).fill("2");
    await page.getByRole("button", { name: "Ajouter le créneau" }).click();
    await expect(page.getByText("Ouverture", { exact: true })).toBeVisible();
    await expect(page.getByText("Affectations à couvrir", { exact: true }).locator("..")).toContainText("2");
    await page.getByLabel(/Objectif de bénévoles/).fill("4");
    await page.getByRole("button", { name: /Ajouter une question/ }).click();
    await page.getByLabel("Question 1").fill("Taille de t-shirt");
    await page.getByLabel("Type").selectOption("single_choice");
    await page.getByLabel("Options").fill("S, M, L");
    await page.getByRole("button", { name: "Enregistrer les réglages" }).click();
    await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
    await page.getByRole("button", { name: "Ouvrir le recrutement" }).click();
    await expect(page.getByRole("button", { name: "Fermer le recrutement" })).toBeVisible();
  });

  test("Maya candidate sans compte en deux étapes, avec vœux ordonnés, disponibilités et binôme", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`/${slug}/${eventSlug}`);
    await page.getByRole("link", { name: /Je candidate/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Donner un coup\s*de main/);
    await page.getByLabel(/^Prénom/).fill("Maya");
    await page.getByLabel(/^Nom/).fill("Bernard");
    await page.getByLabel(/^E-mail/).fill(mayaEmail);
    await page.getByLabel(/Pourquoi vous/).fill("J'adore l'ambiance des Nuits et je veux aider.");
    await page.getByText("Poste de secours", { exact: false }).first().click();
    await page.getByText("Bar principal", { exact: false }).first().click();
    await expect(page.getByRole("heading", { level: 3, name: /^1\. Poste de secours/ })).toBeVisible();
    await page.getByRole("checkbox", { name: "SST (à vérifier)" }).check();
    await page.getByLabel(/Taille de t-shirt/).selectOption("M");
    await page.getByRole("button", { name: /Continuer : mes disponibilités/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Vos disponibilités" })).toBeVisible();
    await page.getByLabel("Heure de début").first().fill("16:00");
    await page.getByLabel(/E-mail du binôme/).fill(samEmail);
    await page.getByRole("button", { name: "Envoyer ma candidature" }).click();
    await expect(page).toHaveURL(/\/candidature\/[0-9a-f-]+\?k=.*nouveau=1/);
    trackingUrl = page.url();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Candidature\s*bien reçue/);
    await expect(badge(page, "Reçue")).toBeVisible();
    await expect(page.getByText("1. Poste de secours")).toBeVisible();
    await expect(page.getByText("En attente")).toBeVisible();
    expect(lastLinkTo(mayaEmail, /https?:\/\/\S+\/candidature\/\S+/)).toContain("/candidature/");
    // The tracking page is a 404 without the token.
    const res = await page.request.get(new URL(trackingUrl).pathname);
    expect(res.status()).toBe(404);
  });

  test("Léa examine : qualification manquante, vérifie le SST, accepte ; Maya voit « Acceptée »", async ({ page }) => {
    await signIn(page, lea.email, `/o/${slug}/benevoles`);
    await expect(page.getByText("À examiner", { exact: true }).first().locator("..")).toContainText("1");
    await page.getByRole("link", { name: "Examiner →" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Maya Bernard");
    await expect(page.getByText("Qualification manquante")).toBeVisible();
    await expect(page.getByText(samEmail)).toBeVisible();
    await expect(page.getByText("n'a pas candidaté")).toBeVisible();
    await page.getByRole("button", { name: "Marquer vérifiée" }).click();
    await expect(page.getByText("Éligible")).toBeVisible();
    await page.getByLabel(/Notes internes/).fill("Connue de l'équipe 2026.");
    await page.getByRole("button", { name: "Enregistrer les notes" }).click();
    await expect(page.getByText("Notes internes enregistrées")).toBeVisible();
    await page.getByRole("button", { name: "Accepter" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Accepter" }).click();
    await expect(page.getByText("Candidature acceptée, la personne est prévenue.")).toBeVisible();
    await expect(badge(page, "Acceptée")).toBeVisible();
    // Matrix shows Maya available on the opening shift.
    await page.goto(`/o/${slug}/evenements/${eventSlug}/benevoles`);
    await expect(page.getByText("Personnes acceptées", { exact: true }).locator("..")).toContainText("1");
    await expect(page.getByRole("region", { name: "Matrice de disponibilité" })).toContainText("Maya Bernard");

    await page.context().clearCookies();
    await page.goto(trackingUrl.replace("&nouveau=1", ""));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/dans l'équipe/);
    await expect(badge(page, "Acceptée")).toBeVisible();
    await expect(page.getByText("Connue de l'équipe")).toHaveCount(0);
  });

  test("Sam candidate en nommant Maya : binôme réciproque ; liste d'attente ; Sam se retire", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`/${slug}/${eventSlug}/benevoles`);
    await page.getByLabel(/^Prénom/).fill("Sam");
    await page.getByLabel(/^Nom/).fill("Moreau");
    await page.getByLabel(/^E-mail/).fill(samEmail);
    await page.getByText("Bar principal", { exact: false }).first().click();
    await page.getByLabel(/Taille de t-shirt/).selectOption("L");
    await page.getByRole("button", { name: /Continuer : mes disponibilités/ }).click();
    await page.getByLabel(/E-mail du binôme/).fill(mayaEmail);
    await page.getByRole("button", { name: "Envoyer ma candidature" }).click();
    await expect(page).toHaveURL(/\/candidature\/[0-9a-f-]+\?k=/);
    await expect(page.getByText("Souhait réciproque")).toBeVisible();
    const samTracking = page.url();

    await signIn(page, lea.email, `/o/${slug}/benevoles?statut=to_review`);
    await page.getByLabel("Sélectionner Sam Moreau").check();
    await page.getByRole("button", { name: "Liste d'attente" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Placer en attente" }).click();
    await expect(page.getByText("1 candidature(s) traitée(s).")).toBeVisible();

    await page.context().clearCookies();
    await page.goto(samTracking);
    await expect(badge(page, "Liste d'attente")).toBeVisible();
    await page.getByRole("button", { name: "Retirer ma candidature" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
    await expect(badge(page, "Retirée")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retirer ma candidature" })).toHaveCount(0);
    await page.goto(trackingUrl.replace("&nouveau=1", ""));
    await expect(page.getByText("En attente")).toBeVisible();
  });
});
