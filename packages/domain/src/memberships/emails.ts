import { renderTransactionalEmail } from "@kroov/notifications";
import { formatDateFr, formatMoney } from "../kernel";
import type { TicketingContext } from "../ticketing/context";
import type { MemberMembershipView } from "./memberships";

const TZ = "Europe/Paris";
const money = (minor: number, currency: string) =>
  formatMoney({ amountMinor: minor, currency: currency as "EUR" | "CHF" });

function cardUrl(ctx: TicketingContext, m: MemberMembershipView): string {
  return `${ctx.appUrl}/adhesion/${m.id}?k=${m.accessToken}`;
}

export async function sendApplicationReceived(ctx: TicketingContext, m: MemberMembershipView): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: `Votre demande d'adhésion à ${m.organizationName}`,
    paragraphs: [
      `Nous avons bien reçu votre demande pour la formule « ${m.plan.name} ». L'organisation l'examine et vous préviendra dès sa décision.`,
      "Vous pouvez suivre votre demande à tout moment avec le lien ci-dessous (personnel, ne le partagez pas).",
    ],
    action: { label: "Suivre ma demande", url: cardUrl(ctx, m) },
  });
  await ctx.email.send({
    to: m.member.email,
    subject: `${ctx.appName} · Demande d'adhésion reçue · ${m.organizationName}`,
    text,
    html,
  });
}

export async function sendMembershipApproved(ctx: TicketingContext, m: MemberMembershipView): Promise<void> {
  const paid = m.priceMinor > 0;
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: paid ? "Demande acceptée : il ne reste que le paiement" : "Bienvenue parmi les membres",
    paragraphs: [
      `${m.organizationName} a accepté votre adhésion « ${m.plan.name} ».`,
      paid
        ? `Réglez la cotisation de ${money(m.priceMinor, m.currency)}${m.feesMinor > 0 ? ` (+ ${money(m.feesMinor, m.currency)} de frais de service)` : ""} pour l'activer.`
        : "Votre adhésion est active : votre carte adhérent est disponible ci-dessous.",
    ],
    action: { label: paid ? "Payer ma cotisation" : "Voir ma carte adhérent", url: cardUrl(ctx, m) },
  });
  await ctx.email.send({
    to: m.member.email,
    subject: `${ctx.appName} · ${paid ? "Adhésion acceptée, paiement attendu" : "Adhésion active"} · ${m.organizationName}`,
    text,
    html,
  });
}

export async function sendMembershipActivated(ctx: TicketingContext, m: MemberMembershipView): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Le collectif, c'est aussi vous.",
    paragraphs: [
      `Votre adhésion « ${m.plan.name} » à ${m.organizationName} est active (n° ${m.number}).`,
      m.validUntil ? `Valable jusqu'au ${formatDateFr(m.validUntil, TZ)}. Sans renouvellement automatique.` : "",
      "Une adhésion n'est pas un billet : l'accès aux événements nécessite un billet séparé.",
    ].filter(Boolean),
    action: { label: "Voir ma carte adhérent", url: cardUrl(ctx, m) },
  });
  await ctx.email.send({
    to: m.member.email,
    subject: `${ctx.appName} · Votre carte adhérent · ${m.organizationName}`,
    text,
    html,
  });
}

export async function sendMembershipRejected(
  ctx: TicketingContext,
  m: MemberMembershipView,
  reason: string,
): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Votre demande d'adhésion n'a pas été retenue",
    paragraphs: [
      `${m.organizationName} n'a pas donné suite à votre demande pour « ${m.plan.name} ».`,
      `Motif : ${reason}.`,
      "Aucun montant ne vous a été prélevé.",
    ],
  });
  await ctx.email.send({
    to: m.member.email,
    subject: `${ctx.appName} · Demande d'adhésion · ${m.organizationName}`,
    text,
    html,
  });
}

export async function sendRenewalReminder(ctx: TicketingContext, m: MemberMembershipView): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "On continue ensemble ?",
    paragraphs: [
      `Votre adhésion « ${m.plan.name} » à ${m.organizationName} expire le ${m.validUntil ? formatDateFr(m.validUntil, TZ) : "bientôt"}.`,
      "Le renouvellement est manuel : choisissez votre formule pour la prochaine période depuis votre carte adhérent.",
    ],
    action: { label: "Renouveler mon adhésion", url: cardUrl(ctx, m) },
  });
  await ctx.email.send({
    to: m.member.email,
    subject: `${ctx.appName} · Votre adhésion expire bientôt · ${m.organizationName}`,
    text,
    html,
  });
}

export async function sendMembershipExpired(ctx: TicketingContext, m: MemberMembershipView): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Votre adhésion a expiré",
    paragraphs: [
      `L'adhésion « ${m.plan.name} » à ${m.organizationName} (n° ${m.number}) est arrivée à échéance.`,
      "Vous pouvez la renouveler depuis votre carte adhérent si une formule est proposée.",
    ],
    action: { label: "Voir ma carte adhérent", url: cardUrl(ctx, m) },
  });
  await ctx.email.send({
    to: m.member.email,
    subject: `${ctx.appName} · Adhésion expirée · ${m.organizationName}`,
    text,
    html,
  });
}
