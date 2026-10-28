import { renderTransactionalEmail } from "@kroov/notifications";
import { formatRangeFr } from "../kernel";
import type { TicketingContext } from "../ticketing/context";
import type { CandidateApplicationView } from "./applications";

/** What the volunteers module needs from the app: mail, naming, URLs and the HMAC secret. */
export type VolunteerContext = Pick<TicketingContext, "email" | "appName" | "appUrl" | "credentialSecret">;

function trackingUrl(ctx: VolunteerContext, a: CandidateApplicationView): string {
  return `${ctx.appUrl}/candidature/${a.id}?k=${a.accessToken}`;
}

function eventLine(a: CandidateApplicationView): string {
  return `${a.event.title} · ${formatRangeFr(a.event.startsAt, a.event.endsAt, a.event.timezone)}`;
}

export async function sendVolunteerApplicationReceived(
  ctx: VolunteerContext,
  a: CandidateApplicationView,
): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Merci : votre candidature est bien arrivée",
    paragraphs: [
      `${a.organizationName} a reçu votre candidature bénévole pour ${eventLine(a)} (réf. ${a.number}).`,
      "L'équipe l'examine et vous écrira dès sa décision. Vous pouvez compléter vos disponibilités ou vos vœux à tout moment avec le lien ci-dessous (personnel, ne le partagez pas).",
    ],
    action: { label: "Suivre ma candidature", url: trackingUrl(ctx, a) },
  });
  await ctx.email.send({
    to: a.email,
    subject: `${ctx.appName} · Candidature reçue · ${a.event.title}`,
    text,
    html,
  });
}

export async function sendVolunteerApproved(ctx: VolunteerContext, a: CandidateApplicationView): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Bienvenue dans l'équipe !",
    paragraphs: [
      `${a.organizationName} a accepté votre candidature pour ${eventLine(a)}.`,
      "Accepter ne publie pas encore de mission : vous recevrez vos créneaux dès que le planning sera validé par l'équipe. D'ici là, gardez vos disponibilités à jour.",
    ],
    action: { label: "Voir ma candidature", url: trackingUrl(ctx, a) },
  });
  await ctx.email.send({
    to: a.email,
    subject: `${ctx.appName} · Candidature acceptée · ${a.event.title}`,
    text,
    html,
  });
}

export async function sendVolunteerWaitlisted(ctx: VolunteerContext, a: CandidateApplicationView): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Vous êtes sur la liste d'attente",
    paragraphs: [
      `Pour ${eventLine(a)}, ${a.organizationName} a déjà assez de bénévoles sur les postes que vous avez demandés. Vous êtes en liste d'attente : si une place se libère, l'équipe vous contactera.`,
      "Vous pouvez élargir vos vœux ou vos disponibilités pour augmenter vos chances.",
    ],
    action: { label: "Modifier ma candidature", url: trackingUrl(ctx, a) },
  });
  await ctx.email.send({
    to: a.email,
    subject: `${ctx.appName} · Liste d'attente · ${a.event.title}`,
    text,
    html,
  });
}

export async function sendVolunteerRejected(
  ctx: VolunteerContext,
  a: CandidateApplicationView,
  reason: string,
): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Votre candidature n'a pas été retenue",
    paragraphs: [
      `${a.organizationName} n'a pas pu retenir votre candidature pour ${eventLine(a)}.`,
      `Motif communiqué : ${reason}`,
      "Merci pour votre proposition d'aide ; d'autres événements pourront en avoir besoin.",
    ],
  });
  await ctx.email.send({
    to: a.email,
    subject: `${ctx.appName} · Candidature non retenue · ${a.event.title}`,
    text,
    html,
  });
}

export async function sendVolunteerWithdrawn(ctx: VolunteerContext, a: CandidateApplicationView): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Candidature retirée",
    paragraphs: [
      `Votre candidature bénévole pour ${eventLine(a)} (${a.organizationName}) est retirée. Si c'est une erreur, vous pouvez candidater à nouveau tant que le recrutement est ouvert.`,
    ],
  });
  await ctx.email.send({
    to: a.email,
    subject: `${ctx.appName} · Candidature retirée · ${a.event.title}`,
    text,
    html,
  });
}

/** Sent to a buddy named by a candidate. Says nothing beyond the inviter's name and the event. */
export async function sendBuddyInvitation(
  ctx: VolunteerContext,
  to: string,
  inviterName: string,
  a: CandidateApplicationView,
  applyUrl: string,
): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: `${inviterName} aimerait être bénévole avec vous`,
    paragraphs: [
      `${inviterName} a candidaté comme bénévole pour ${eventLine(a)} (${a.organizationName}) et souhaite faire équipe avec vous.`,
      "Si cela vous tente, candidatez à votre tour et indiquez son adresse e-mail comme binôme : l'équipe tentera de vous placer ensemble (sans garantie, selon les besoins).",
    ],
    action: { label: "Candidater", url: applyUrl },
  });
  await ctx.email.send({ to, subject: `${ctx.appName} · ${inviterName} vous propose un binôme bénévole`, text, html });
}
