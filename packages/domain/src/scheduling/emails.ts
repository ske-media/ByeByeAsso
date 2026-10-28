import { renderTransactionalEmail } from "@kroov/notifications";
import { formatRangeFr } from "../kernel";
import type { VolunteerContext } from "../volunteers/emails";

export interface MissionLine {
  positionName: string;
  label: string | null;
  startsAt: Date;
  endsAt: Date;
  change: "new" | "changed" | "unchanged" | "removed";
}

function line(m: MissionLine, tz: string): string {
  const tag =
    m.change === "new"
      ? "NOUVEAU · "
      : m.change === "removed"
        ? "RETIRÉ · "
        : m.change === "changed"
          ? "MODIFIÉ · "
          : "";
  return `${tag}${m.positionName}${m.label ? ` (${m.label})` : ""} — ${formatRangeFr(m.startsAt, m.endsAt, tz)}`;
}

/** Published schedule: only the volunteer's own missions, with what changed since the previous version. */
export async function sendMissionsPublished(
  ctx: VolunteerContext,
  to: string,
  firstName: string,
  info: { organizationName: string; eventTitle: string; timezone: string; versionLabel: string; trackingUrl: string },
  missions: MissionLine[],
): Promise<void> {
  const changed = missions.filter((m) => m.change !== "unchanged");
  const kept = missions.filter((m) => m.change === "unchanged");
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title:
      changed.some((m) => m.change === "new") && kept.length === 0
        ? "Vos missions sont prêtes"
        : "Votre planning a changé",
    paragraphs: [
      `${firstName}, ${info.organizationName} a publié le planning ${info.versionLabel} de « ${info.eventTitle} ». Cette version fait foi.`,
      changed.length > 0
        ? `Ce qui vous concerne :\n${changed.map((m) => `• ${line(m, info.timezone)}`).join("\n")}`
        : "Aucune de vos missions ne change.",
      kept.length > 0 ? `Inchangé :\n${kept.map((m) => `• ${line(m, info.timezone)}`).join("\n")}` : "",
      "Merci de confirmer chaque mission depuis votre espace, ou de signaler une indisponibilité : l'équipe arbitrera, rien n'est retiré automatiquement.",
    ].filter(Boolean),
    action: { label: "Voir mes missions", url: info.trackingUrl },
  });
  await ctx.email.send({
    to,
    subject: `${ctx.appName} · Planning ${info.versionLabel} · ${info.eventTitle}`,
    text,
    html,
  });
}

export async function sendUnavailabilityReceived(
  ctx: VolunteerContext,
  to: string,
  info: { eventTitle: string; mission: string; trackingUrl: string },
): Promise<void> {
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: "Indisponibilité bien reçue",
    paragraphs: [
      `Votre signalement pour la mission « ${info.mission} » (${info.eventTitle}) est transmis à l'équipe. La mission reste affichée tant qu'un·e responsable n'a pas arbitré ; vous serez prévenu·e du résultat.`,
    ],
    action: { label: "Voir mes missions", url: info.trackingUrl },
  });
  await ctx.email.send({ to, subject: `${ctx.appName} · Indisponibilité reçue · ${info.eventTitle}`, text, html });
}
