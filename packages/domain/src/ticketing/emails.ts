import { renderTransactionalEmail } from "@kroov/notifications";
import { formatMoney, formatRangeFr } from "../kernel";
import type { TicketingContext } from "./context";
import type { BuyerOrderView, OrderView } from "./orders";

function amount(minor: number, currency: string): string {
  return formatMoney({ amountMinor: minor, currency: currency as "EUR" | "CHF" });
}

function orderUrl(ctx: TicketingContext, view: BuyerOrderView): string {
  return `${ctx.appUrl}/commande/${view.id}?k=${view.accessToken}`;
}

/** Confirmation with the order link and one link per ticket. Never includes the QR credential. */
export async function sendOrderConfirmation(
  ctx: TicketingContext,
  view: BuyerOrderView,
  opts: { resend?: boolean } = {},
): Promise<void> {
  const when = formatRangeFr(view.event.startsAt, view.event.endsAt, view.event.timezone);
  const place = view.event.locationName
    ? `${view.event.locationName}${view.event.city ? `, ${view.event.city}` : ""}`
    : "lieu à confirmer";
  const live = view.tickets.filter((t) => t.status === "valid" || t.status === "used");
  const lines = live.map(
    (t) =>
      `• ${t.number} · ${t.typeLabel}${t.attendeeName ? ` · ${t.attendeeName}` : ""} : ${ctx.appUrl}/billets/${view.ticketLinks[t.id] ?? ""}`,
  );
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: opts.resend
      ? `Vos billets pour ${view.event.title} (renvoi)`
      : `C'est dans la poche ! Vos billets pour ${view.event.title}`,
    paragraphs: [
      `Commande ${view.number} · ${view.organizationName}.`,
      `${view.event.title} — ${when} — ${place}.`,
      `${live.length} billet(s)${view.totalMinor > 0 ? ` · total payé ${amount(view.totalMinor, view.currency)}` : " · entrée gratuite"}.`,
      ...(lines.length > 0 ? ["Vos billets (un lien par personne, à présenter à l'entrée) :", ...lines] : []),
      ...(opts.resend ? ["Les liens envoyés précédemment ne fonctionnent plus."] : []),
    ],
    action: { label: "Voir ma commande", url: orderUrl(ctx, view) },
  });
  await ctx.email.send({
    to: view.buyer.email,
    subject: `${ctx.appName} · Vos billets pour ${view.event.title}`,
    text,
    html,
  });
}

export async function sendPaymentFailed(
  ctx: TicketingContext,
  view: BuyerOrderView,
  reason: string | null,
): Promise<void> {
  const stillReserved = view.expiresAt && view.expiresAt.getTime() > Date.now();
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "On réessaie ?",
    paragraphs: [
      `Le paiement de la commande ${view.number} (${view.event.title}) n'a pas abouti${reason ? ` : ${reason}` : ""}. Aucun billet n'a été émis et vous ne serez pas débité pour cette tentative.`,
      stillReserved
        ? `Vos places restent réservées jusqu'à ${view.expiresAt?.toLocaleTimeString("fr-FR", { timeZone: view.event.timezone, hour: "2-digit", minute: "2-digit" })}.`
        : "La réservation a expiré : vous pouvez vérifier les places disponibles et recommencer.",
    ],
    action: {
      label: stillReserved ? "Utiliser une autre carte" : "Vérifier les places disponibles",
      url: stillReserved ? orderUrl(ctx, view) : `${ctx.appUrl}/${view.organizationSlug}/${view.event.slug}/billets`,
    },
  });
  await ctx.email.send({
    to: view.buyer.email,
    subject: `${ctx.appName} · Paiement non abouti · ${view.number}`,
    text,
    html,
  });
}

export async function sendRefundNotice(
  ctx: TicketingContext,
  view: OrderView,
  refund: { amountMinor: number; reason: string; ticketNumbers: string[] },
): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: `Remboursement de ${amount(refund.amountMinor, view.currency)}`,
    paragraphs: [
      `${view.organizationName} a remboursé ${amount(refund.amountMinor, view.currency)} sur la commande ${view.number} (${view.event.title}).`,
      refund.ticketNumbers.length > 0
        ? `Billets concernés, désormais invalides : ${refund.ticketNumbers.join(", ")}.`
        : "La commande a été remboursée intégralement.",
      `Motif : ${refund.reason}.`,
      "Le délai de retour sur votre moyen de paiement dépend de votre banque (généralement 5 à 10 jours).",
    ],
  });
  await ctx.email.send({
    to: view.buyer.email,
    subject: `${ctx.appName} · Remboursement · ${view.number}`,
    text,
    html,
  });
}

export async function sendLatePaymentRefunded(ctx: TicketingContext, view: OrderView): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Paiement reçu trop tard",
    paragraphs: [
      `Votre paiement pour la commande ${view.number} (${view.event.title}) nous est parvenu après l'expiration de la réservation et les places ne sont plus disponibles.`,
      `Le montant de ${amount(view.totalMinor, view.currency)} vous est intégralement remboursé. Aucun billet n'a été émis.`,
    ],
    action: {
      label: "Vérifier les places disponibles",
      url: `${ctx.appUrl}/${view.organizationSlug}/${view.event.slug}/billets`,
    },
  });
  await ctx.email.send({
    to: view.buyer.email,
    subject: `${ctx.appName} · Paiement remboursé · ${view.number}`,
    text,
    html,
  });
}
