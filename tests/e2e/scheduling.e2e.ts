import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { lastLinkTo, onBase } from "./helpers/outbox";

/**
 * Phase 6 journey in the browser:
 * besoins (équipe, poste, deux créneaux) → deux bénévoles acceptés → générer une proposition V1 →
 * arbitrer (retirer, affecter par formulaire avec explications, verrouiller) → publier V1 →
 * Maya voit sa mission et la confirme → Maya signale une indisponibilité → l'équipe voit l'arbitrage →
 * version de travail V2 basée sur la publiée, remplacement, différentiel, publication V2 →
 * Maya n'a plus de mission, Lou est notifiée du changement.
 */
const run = randomUUID().slice(0, 8);
const password = "les-nuits-en-commun-2027";
const lea = { name: "Léa Martin", email: `lea-p-${run}@e2e.kroov.local` };
const orgName = `Collectif Planning ${run}`;
const slug = `planning-${run}`;
const eventTitle = `Nuit du planning ${run}`;
const eventSlug = `nuit-planning-${run}`;
const mayaEmail = `maya-${run}@e2e.kroov.local`;
const louEmail = `lou-${run}@e2e.kroov.local`;

function dateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const eventDay = dateInDays(25);

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

async function applyAs(page: Page, first: string, email: string) {
  await page.context().clearCookies();
  await page.goto(`/${slug}/${eventSlug}/benevoles`);
  await page.getByLabel(/^Prénom/).fill(first);
  await page.getByLabel(/^Nom/).fill("Test");
  await page.getByLabel(/^E-mail/).fill(email);
  await page.getByText("Accueil", { exact: false }).first().click();
  await page.getByRole("button", { name: /Continuer : mes disponibilités/ }).click();
  await page.getByLabel("Heure de début").first().fill("16:00");
  await page.getByRole("button", { name: "Envoyer ma candidature" }).click();
  await expect(page).toHaveURL(/\/candidature\/[0-9a-f-]+\?k=/);
  return page.url().replace("&nouveau=1", "");
}

test.describe.configure({ mode: "serial" });

let mayaUrl = "";
let louUrl = "";

test.describe("Phase 6 — planning", () => {
  test("Léa prépare les besoins et accepte deux bénévoles", async ({ page, baseURL }) => {
    await signUpAndVerify(page, baseURL!, lea, "/organisations/nouvelle");
    await signIn(page, lea.email, "/organisations/nouvelle");
    await page.getByLabel(/^Nom/).fill(orgName);
    await page.getByLabel(/Identifiant d'adresse/).fill(slug);
    await page.getByRole("button", { name: /Créer l'organisation/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
    await page.goto(`/o/${slug}/benevoles?onglet=equipes`);
    await page.getByRole("button", { name: /Nouvelle équipe/ }).click();
    await page.getByLabel(/Nom de l'équipe/).fill("Accueil");
    await page.getByRole("button", { name: "Créer l'équipe" }).click();
    await page.getByRole("button", { name: /Nouveau poste/ }).click();
    await page.getByLabel(/Nom du poste/).fill("Accueil");
    await page.getByRole("button", { name: "Créer le poste" }).click();
    await expect(page.getByText("Accueil", { exact: true }).first()).toBeVisible();
    await page.goto(`/o/${slug}/lieux`);
    await page.getByLabel(/Nom du lieu/).fill("Le Sucre");
    await page.getByLabel(/^Ville/).fill("Lyon");
    await page.getByRole("button", { name: "Ajouter le lieu" }).click();
    await page.goto(`/o/${slug}/evenements/nouveau`);
    await page.getByLabel(/^Titre/).fill(eventTitle);
    await page.getByLabel(/Identifiant d'adresse/).fill(eventSlug);
    await page
      .getByLabel(/^Description/)
      .fill("Une nuit où le planning se propose, s'arbitre et se publie par une humaine.");
    await page.getByLabel(/Date de début/).fill(eventDay);
    await page.getByLabel(/Heure de début/).fill("18:00");
    await page.getByLabel(/Date de fin/).fill(eventDay);
    await page.getByLabel(/Heure de fin/).fill("23:00");
    await page.getByLabel(/^Lieu/).selectOption({ label: "Le Sucre · Lyon" });
    await page.getByLabel(/^Capacité/).fill("200");
    await page.getByRole("button", { name: "Créer l'événement" }).click();
    await page.getByRole("link", { name: /Publier/ }).click();
    await page.getByRole("button", { name: /Publier l'événement/ }).click();
    await expect(page.getByText("Événement publié")).toBeVisible();
    await page.goto(`/o/${slug}/evenements/${eventSlug}/benevoles`);
    await page.getByLabel(/Activer un poste type/).selectOption({ label: "Accueil · Accueil" });
    await page.getByRole("button", { name: "Activer", exact: true }).click();
    for (const [label, from, to] of [
      ["Ouverture", "17:00", "19:30"],
      ["Soirée", "20:00", "23:00"], // 30 min of rest between the two: one person may do both
    ] as const) {
      await page
        .getByRole("button", { name: /\+ Créneau/ })
        .first()
        .click();
      await page.getByLabel(/^Libellé/).fill(label);
      await page.getByLabel(/Début \(date\)/).fill(eventDay);
      await page.getByLabel(/Début \(heure\)/).fill(from);
      await page.getByLabel(/Fin \(date\)/).fill(eventDay);
      await page.getByLabel(/Fin \(heure\)/).fill(to);
      await page.getByLabel(/Effectif requis/).fill("1");
      await page.getByRole("button", { name: "Ajouter le créneau" }).click();
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Ouvrir le recrutement" }).click();
    await expect(page.getByRole("button", { name: "Fermer le recrutement" })).toBeVisible();

    mayaUrl = await applyAs(page, "Maya", mayaEmail);
    louUrl = await applyAs(page, "Lou", louEmail);
    await signIn(page, lea.email, `/o/${slug}/benevoles?statut=to_review`);
    await page.getByLabel("Tout sélectionner").check();
    await page.getByRole("button", { name: "Accepter" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Accepter" }).click();
    await expect(page.getByText("2 candidature(s) traitée(s).")).toBeVisible();
  });

  test("Léa génère V1, arbitre par formulaire avec explications, verrouille et publie", async ({ page }) => {
    await signIn(page, lea.email, `/o/${slug}/evenements/${eventSlug}/planning`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Pas encore de planning.");
    await page.getByRole("button", { name: "Nouvelle version + proposition" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Planning V1");
    await expect(badge(page, "Proposition").first()).toBeVisible();
    await expect(page.getByText("Affectations couvertes", { exact: true }).locator("..")).toContainText("2");
    await expect(page.getByText(/Dernière exécution : kroov-greedy-ls\/1/)).toBeVisible();

    // Arbitration: remove the opening assignment, then reassign by form (explanations listed), locked.
    const opening = page.locator("li", { hasText: "Accueil · Ouverture" }).first();
    await opening.getByRole("button", { name: "Retirer" }).click();
    await expect(page.getByText("Affectation retirée.")).toBeVisible();
    await expect(page.getByText(/Non pourvus : Accueil · Ouverture/)).toBeVisible();
    // The engine's V1 may have put either person on the evening shift: put the OTHER one on the opening
    // so that both volunteers hold exactly one mission (deterministic notification count below).
    const evening = page.locator("li", { hasText: "Accueil · Soirée" }).first();
    const eveningIsMaya = (await evening.textContent())?.includes("Maya Test") ?? false;
    await opening.getByRole("button", { name: /Affecter…/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Bénévole éligible");
    const eligible = page.getByRole("dialog").getByLabel(/Bénévole éligible/);
    const wanted = await eligible
      .locator("option", { hasText: eveningIsMaya ? "Lou Test" : "Maya Test" })
      .getAttribute("value");
    await eligible.selectOption(wanted ?? "");
    await page
      .getByRole("dialog")
      .getByLabel(/Verrouiller/)
      .check();
    await page.getByRole("dialog").getByRole("button", { name: "Affecter" }).click();
    await expect(page.getByText("Affectation ajoutée.")).toBeVisible();
    await expect(page.getByText("manuelle")).toBeVisible();
    await expect(page.getByRole("button", { name: "Déverrouiller" })).toBeVisible();
    await expect(page.getByText("Affectations couvertes", { exact: true }).locator("..")).toContainText("2");

    // Publish V1 (human validation).
    await page.getByRole("button", { name: "Publier le planning V1" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publier V1" }).click();
    await expect(page.getByText(/Planning V1 publié : 2 bénévole\(s\) notifié\(s\)/)).toBeVisible();
    await expect(badge(page, "Publiée").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Affecter…/ })).toHaveCount(0);
    expect(lastLinkTo(mayaEmail, /https?:\/\/\S+\/candidature\/\S+/)).toContain("/candidature/");
  });

  test("Maya voit sa mission, la confirme, puis signale une indisponibilité ; l'équipe arbitre avec V2", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto(mayaUrl);
    await expect(page.getByRole("heading", { level: 2, name: /Mes missions · planning V1/ })).toBeVisible();
    await expect(badge(page, "À confirmer")).toBeVisible();
    await page.getByRole("button", { name: "Je confirme" }).click();
    await expect(page.getByText("Mission confirmée. Merci !")).toBeVisible();
    await expect(badge(page, "Confirmée")).toBeVisible();
    await page.getByRole("button", { name: "Je ne suis plus disponible" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/Un mot pour l'équipe/)
      .fill("Empêchement de dernière minute");
    await page.getByRole("dialog").getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(page.getByText(/Indisponibilité transmise/)).toBeVisible();
    await expect(page.getByText("Signalement en attente d'arbitrage.")).toBeVisible();

    await signIn(page, lea.email, `/o/${slug}/evenements/${eventSlug}/planning`);
    await expect(page.getByText("Demandes d'arbitrage", { exact: true }).first().locator("..")).toContainText("1");
    await expect(page.getByText(/Maya Test signale une indisponibilité/)).toBeVisible();
    await page.getByRole("button", { name: "Version de travail à partir de la publiée" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Planning V2");
    await expect(page.getByText("Aucune différence avec la version publiée.")).toBeVisible();
    // Replace Maya: remove her, assign Lou on her shift (Lou can be on both: no overlap).
    const mayaRow = page.locator("li", { hasText: "Maya Test" }).first();
    await mayaRow.getByRole("button", { name: "Retirer" }).click();
    await expect(page.getByText("Affectation retirée.")).toBeVisible();
    // Only the now-empty shift offers a slot (max 1 per shift).
    await page.getByRole("button", { name: /Affecter…/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Affecter" }).click();
    await expect(page.getByText("Affectation ajoutée.")).toBeVisible();
    await expect(page.getByText("Différentiel avec V1").locator("..")).toContainText("Retrait");
    await expect(page.getByText("Différentiel avec V1").locator("..")).toContainText("Ajout");
    await page.getByRole("button", { name: "Publier le planning V2" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/Note de version/)
      .fill("Remplacement de Maya");
    await page.getByRole("dialog").getByRole("button", { name: "Publier V2" }).click();
    await expect(
      page.getByText(/Planning V2 publié : 2 bénévole\(s\) notifié\(s\), version précédente remplacée/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Traitée (remplacement fait)" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Traitée" }).click();
    await expect(page.getByText("Demande traitée.")).toBeVisible();
    await page.goto(`/o/${slug}/planning`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Qui, où, quand.");
    await expect(badge(page, "V2").first()).toBeVisible();

    // Maya has no mission any more; Lou sees two missions on V2 and was told what changed.
    await page.context().clearCookies();
    await page.goto(mayaUrl);
    await expect(page.getByRole("heading", { level: 2, name: /Mes missions/ })).toHaveCount(0);
    await page.goto(louUrl);
    await expect(page.getByRole("heading", { level: 2, name: /Mes missions · planning V2/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Je confirme" })).toHaveCount(2);
  });
});
