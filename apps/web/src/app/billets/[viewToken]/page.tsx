import { formatDateFr, formatTimeFr, NotFoundError } from "@kroov/domain/kernel";
import { getTicketByViewToken, TICKET_STATUS_LABELS } from "@kroov/domain/ticketing";
import { Alert, Badge } from "@kroov/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Votre billet", robots: { index: false, follow: false } };

/** Écran 32 — Billet numérique : QR (identifiant opaque dérivé, jamais stocké en clair). */
export default async function TicketPage({ params }: { params: Promise<{ viewToken: string }> }) {
  const { viewToken } = await params;
  let ticket: Awaited<ReturnType<typeof getTicketByViewToken>>;
  try {
    ticket = await getTicketByViewToken(db(), ticketingContext(), viewToken);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const tz = ticket.event.timezone;
  const svg = ticket.qrCredential
    ? await QRCode.toString(ticket.qrCredential, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        color: { dark: "#181914", light: "#ffffff" },
      })
    : null;
  const index = ticket.siblings.findIndex((s) => s.id === ticket.id);
  const next = index >= 0 ? ticket.siblings[index + 1] : undefined;
  const tone = ticket.status === "valid" ? "lime" : ticket.status === "used" ? "neutral" : "error";

  return (
    <AppPublicShell back={{ href: `/${ticket.organization.slug}/${ticket.event.slug}`, label: "Retour à l'événement" }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">
          Mes billets{ticket.siblings.length > 1 && index >= 0 ? ` · ${index + 1} sur ${ticket.siblings.length}` : ""}
        </p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
          {ticket.status === "valid"
            ? "Prêt à entrer ?"
            : ticket.status === "used"
              ? "Bonne soirée !"
              : "Billet inactif"}
        </h1>
        {ticket.status === "refunded" || ticket.status === "revoked" ? (
          <Alert
            tone="error"
            heading={ticket.status === "refunded" ? "Billet remboursé" : "Billet annulé"}
            className="mt-4"
          >
            Ce billet ne donne plus accès à l'événement.
          </Alert>
        ) : null}
        <article className="mt-4 rounded-[14px] border-[1.5px] border-ink bg-surface p-5 text-center">
          <p className="text-eyebrow font-extrabold uppercase">{ticket.organization.name}</p>
          <p className="mt-1 text-[22px] font-black">{ticket.attendeeName ?? ticket.order.buyerName}</p>
          <Badge tone={tone} className="mt-2">
            {TICKET_STATUS_LABELS[ticket.status]}
          </Badge>
          {svg ? (
            <div
              className="mx-auto mt-4 w-[220px] max-w-full [&>svg]:h-auto [&>svg]:w-full"
              aria-label={`QR code du billet ${ticket.number}`}
              role="img"
            >
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated server-side from an opaque credential */}
              <div dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
          ) : (
            <div className="mx-auto mt-4 flex h-[220px] w-[220px] items-center justify-center rounded-[9px] bg-neutral text-[12px] text-muted">
              QR désactivé
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted">
            {ticket.status === "used"
              ? `Entrée enregistrée le ${ticket.usedAt ? `${formatDateFr(ticket.usedAt, tz)} à ${formatTimeFr(ticket.usedAt, tz)}` : ""}`
              : "À présenter à l'entrée · un billet par personne"}
          </p>
          <p className="mt-1 text-[13px] font-bold tracking-[1px]">
            {ticket.order.number} · BILLET {ticket.number.split("-").at(-1)}
          </p>
          <dl className="m-0 mt-4 border-t border-dashed border-ink pt-3 text-[13px]">
            <div className="flex justify-between py-1">
              <dt>{formatDateFr(ticket.event.startsAt, tz)}</dt>
              <dd className="m-0">
                {formatTimeFr(ticket.event.startsAt, tz)} → {formatTimeFr(ticket.event.endsAt, tz)}
              </dd>
            </div>
            <div className="flex justify-between py-1">
              <dt>
                {ticket.event.locationName
                  ? `${ticket.event.locationName}${ticket.event.city ? ` · ${ticket.event.city}` : ""}`
                  : "Lieu à confirmer"}
              </dt>
              <dd className="m-0">{ticket.typeLabel}</dd>
            </div>
            {ticket.event.doorsAt ? (
              <p className="pt-1 text-[11px] text-muted">
                Ouverture des portes à {formatTimeFr(ticket.event.doorsAt, tz)}
              </p>
            ) : null}
          </dl>
        </article>
        {ticket.qrCredential ? (
          <p className="mt-4 text-center text-[12px] text-muted">
            Code manuel (si le QR ne se lit pas) :{" "}
            <code className="break-all rounded bg-neutral px-1">{ticket.qrCredential}</code>
          </p>
        ) : null}
        {next ? (
          <p className="mt-4 text-center text-[12px]">
            Présentez un billet par personne.
            <span className="block text-muted">Suivant : {next.attendeeName ?? next.number}</span>
          </p>
        ) : null}
        <p className="mt-4 text-center text-[11px] text-muted">
          Ce lien est personnel : ne le partagez qu'avec la personne qui utilisera ce billet.
        </p>
      </div>
    </AppPublicShell>
  );
}
