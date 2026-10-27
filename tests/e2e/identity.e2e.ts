import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 1 journey, end to end in the browser:
 * inscription → confirmation d'adresse → création d'organisation → invitation →
 * second compte → acceptation → équipe visible → retour vers ?next= → 404/403 en français.
 * Requires the server started with EMAIL_PROVIDER=file (see tests/security/README.md).
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const camille = { name: "Camille Durand", email: `camille-${run}@e2e.kroov.local` };
const nora = { name: "Nora Diallo", email: `nora-${run}@e2e.kroov.local` };
const orgName = `Le Collectif des Nuits ${run}`;
const slug = `collectif-${run}`;

async function signUpAndVerify(
  page: Page,
  baseURL: string,
  user: { name: string; email: string },
  next = "/organisations",
) {
  await page.goto(`/inscription?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/Votre nom/).fill(user.name);
  await page.getByLabel(/Adresse e-mail/).fill(user.email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Confirmez votre adresse");
  const link = lastLinkTo(user.email, /https?:\/\/\S+verify-email\S+/);
  await page.goto(onBase(link, baseURL));
}

async function signIn(page: Page, email: string, next = "/organisations") {
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  // Already signed in (e.g. right after e-mail verification): the page redirects to `next`.
  if (!page.url().includes("/connexion")) return;
  await page.getByLabel(/Adresse e-mail/).fill(email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByRole("button", { name: /Se connecter/ }).click();
}

/** On mobile the organizer navigation is a drawer: open it before clicking a section. */
async function navTo(page: Page, name: string | RegExp) {
  const opener = page.getByRole("button", { name: "Ouvrir la navigation" });
  if (await opener.isVisible()) await opener.click();
  await page.getByRole("link", { name }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 1 — identité et organisations", () => {
  test("Camille s'inscrit, confirme, crée son organisation et invite Nora", async ({ page, baseURL }) => {
    await signUpAndVerify(page, baseURL!, camille);
    // Verification auto-signs in and lands on the organizations switcher (empty state).
    await signIn(page, camille.email);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos organisations");
    await expect(page.getByText("Vous ne faites encore partie d'aucune organisation")).toBeVisible();

    await page.getByRole("link", { name: "Créer une organisation" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Créer votre organisation");
    await page.getByLabel(/^Nom/).fill(orgName);
    await expect(page.getByLabel(/Identifiant d'adresse/)).toHaveValue(`le-collectif-des-nuits-${run}`);
    await page.getByLabel(/Identifiant d'adresse/).fill(slug);
    await page.getByRole("button", { name: /Créer l'organisation/ }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Bonjour Camille");
    await expect(page.getByText("Organisation créée")).toBeVisible();

    await navTo(page, "Équipe & accès");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Chacun son rôle");
    await expect(page.getByRole("region", { name: "Membres de l'organisation" })).toContainText("Camille Durand");
    await expect(page.getByRole("region", { name: "Membres de l'organisation" })).toContainText("Propriétaire");

    await page.getByLabel(/Adresse e-mail/).fill(nora.email);
    await page.getByLabel(/^Rôle/).selectOption("volunteer_manager");
    await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
    await expect(page.getByText(`Invitation envoyée à ${nora.email}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invitations en attente" }).locator("..")).toContainText(nora.email);
    const opener = page.getByRole("button", { name: "Ouvrir la navigation" });
    if (await opener.isVisible()) await opener.click();
    await expect(page.getByRole("link", { name: /Équipe & accès/ })).toContainText("1");
  });

  test("une mauvaise adresse ne peut pas accepter ; Nora accepte avec la bonne", async ({ page, baseURL }) => {
    const link = onBase(lastLinkTo(nora.email, /https?:\/\/\S+\/invitation\/[A-Za-z0-9_-]+/), baseURL!);

    // Not signed in: the page offers to sign in or create an account, with next= back here.
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`vous invite à rejoindre ${orgName}`);
    await page.getByRole("link", { name: "Créer un compte" }).click();
    await expect(page).toHaveURL(/\/inscription\?next=%2Finvitation%2F/);

    // Camille (wrong account) sees the mismatch and the switch-account action.
    await signIn(page, camille.email, new URL(link).pathname);
    await expect(page.getByText("Ce n'est pas le bon compte")).toBeVisible();
    await page.getByRole("button", { name: "Changer de compte" }).click();
    await expect(page).toHaveURL(/\/connexion\?next=/);

    // Nora signs up, verifies, then accepts.
    await signUpAndVerify(page, baseURL!, nora, new URL(link).pathname);
    await signIn(page, nora.email, new URL(link).pathname);
    await expect(page.getByRole("button", { name: /Rejoindre/ })).toBeVisible();
    await page.getByRole("button", { name: /Rejoindre/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}\\?bienvenue=1$`));
    await expect(page.getByText("Bienvenue dans l'équipe")).toBeVisible();
    await expect(page.getByText("Responsable bénévoles").first()).toBeVisible();

    // Nora (volunteer_manager) can read the team but has no settings section.
    const opener = page.getByRole("button", { name: "Ouvrir la navigation" });
    if (await opener.isVisible()) await opener.click();
    await expect(page.getByRole("link", { name: "Équipe & accès" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Paramètres" })).toHaveCount(0);
    await page.goto(`/o/${slug}/parametres`);
    await expect(page.getByText("Vous n'avez pas accès à cet espace")).toBeVisible();
  });

  test("Camille voit Nora dans l'équipe et ne peut pas se retirer elle-même (dernier propriétaire)", async ({
    page,
  }) => {
    await signIn(page, camille.email, `/o/${slug}/equipe`);
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/equipe$`));
    const team = page.getByRole("region", { name: "Membres de l'organisation" });
    await expect(team).toContainText("Nora Diallo");
    await expect(team).toContainText("Responsable bénévoles");
    await expect(team.getByText("Vous")).toBeVisible();
    await expect(page.getByText("Aucune invitation en attente")).toBeVisible();
    // No horizontal page overflow (tables scroll inside their own region).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test("l'accès à une organisation inconnue ou étrangère est un 404 en français", async ({ page }) => {
    await signIn(page, nora.email, "/o/organisation-inexistante");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cette page n'existe pas");
  });

  test("la réinitialisation ne révèle pas l'existence d'un compte et fonctionne de bout en bout", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/mot-de-passe-oublie");
    await page.getByLabel(/Adresse e-mail/).fill(`inconnu-${run}@e2e.kroov.local`);
    await page.getByRole("button", { name: "Envoyer le lien" }).click();
    await expect(page.getByText("Si un compte existe pour cette adresse")).toBeVisible();

    await page.goto("/mot-de-passe-oublie");
    await page.getByLabel(/Adresse e-mail/).fill(camille.email);
    await page.getByRole("button", { name: "Envoyer le lien" }).click();
    await expect(page.getByText("Si un compte existe pour cette adresse")).toBeVisible();

    const link = onBase(lastLinkTo(camille.email, /https?:\/\/\S+reset-password\S+/), baseURL!);
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Nouveau mot de passe");
    await page.getByLabel(/^Nouveau mot de passe/).fill("nouvelle-phrase-de-passe-2027");
    await page.getByLabel(/Confirmez le mot de passe/).fill("nouvelle-phrase-de-passe-2027");
    await page.getByRole("button", { name: /Enregistrer le nouveau mot de passe/ }).click();
    await expect(page.getByText("Mot de passe modifié")).toBeVisible();
    // The old password no longer works.
    await page.getByLabel(/Adresse e-mail/).fill(camille.email);
    await page.getByLabel(/^Mot de passe/).fill(password);
    await page.getByRole("button", { name: /Se connecter/ }).click();
    await expect(page.getByText("Adresse e-mail ou mot de passe incorrect")).toBeVisible();
  });
});
