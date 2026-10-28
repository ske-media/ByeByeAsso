import { getPublicEvent } from "@kroov/domain/events";
import { crossesMidnight, formatDateFr, formatRangeFr, formatTimeFr, NotFoundError } from "@kroov/domain/kernel";
import { getPublicTicketing } from "@kroov/domain/ticketing";
import { Alert, Button, EventPoster, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { ticketingContext } from "@/lib/ticketing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
}): Promise<Metadata> {
  const { orgSlug, eventSlug } = await params;
  try {
    const event = await getPublicEvent(db(), orgSlug, eventSlug);
    return {
      title: `${event.title} · ${event.organization.name}`,
      description: event.tagline ?? undefined,
      robots: event.visibility === "public" ? { index: true, follow: true } : { index: false, follow: false },
    };
  } catch {
    return { title: "Événement introuvable" };
  }
}

/** Écran 27 — Page événement publique. Brouillons et événements privés : 404. */
export default async function PublicEventPage({ params }: { params: Promise<{ orgSlug: string; eventSlug: string }> }) {
  const { orgSlug, eventSlug } = await params;
  let event: Awaited<ReturnType<typeof getPublicEvent>>;
  try {
    event = await getPublicEvent(db(), orgSlug, eventSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const tz = event.timezone;
  const ticketing =
    event.status === "published"
      ? await getPublicTicketing(db(), event.organization.id, event.id, ticketingContext().fees)
      : null;
  const onSale = ticketing?.types.filter((t) => t.saleState === "on_sale") ?? [];
  const cheapest = onSale.length > 0 ? Math.min(...onSale.map((t) => t.priceMinor)) : null;
  const midnight = crossesMidnight(event.startsAt, event.endsAt, tz);
  const programme = event.settings.programme?.split(/\n+/).filter((p) => p.trim().length > 0) ?? [];
  const description = event.description?.split(/\n+/).filter((p) => p.trim().length > 0) ?? [];
  const address = event.location
    ? [
        event.location.addressLine1,
        event.location.addressLine2,
        [event.location.postalCode, event.location.city].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <AppPublicShell
      back={{ href: `/${event.organization.slug}`, label: `Retour aux événements de ${event.organization.name}` }}
    >
      <article className="py-6">
        <EventPoster
          organizationName={event.organization.name}
          title={event.title}
          dateLabel={formatDateFr(event.startsAt, tz)}
          placeLabel={event.location ? `${event.location.city} · ${event.location.name}` : undefined}
        />
        <p className="mt-5 text-eyebrow font-extrabold uppercase text-muted">{event.organization.name}</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">{event.title}</h1>
        {event.tagline ? <p className="mt-2 text-muted">{event.tagline}</p> : null}

        {event.status === "cancelled" ? (
          <Alert tone="error" heading="Événement annulé" className="mt-4">
            {event.cancellationReason}
          </Alert>
        ) : null}
        {event.status === "completed" ? (
          <Alert tone="info" heading="Événement terminé" className="mt-4">
            Merci à toutes les personnes présentes.
          </Alert>
        ) : null}

        <dl className="m-0 mt-5 divide-y divide-border text-[13px]">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">Date</dt>
            <dd className="m-0 text-right font-bold">
              {formatRangeFr(event.startsAt, event.endsAt, tz)}
              {midnight ? (
                <span className="block text-[11px] font-normal text-muted">
                  Se termine le lendemain à {formatTimeFr(event.endsAt, tz)}.
                </span>
              ) : null}
              {event.doorsAt ? (
                <span className="block text-[11px] font-normal text-muted">
                  Ouverture des portes à {formatTimeFr(event.doorsAt, tz)}.
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">Lieu</dt>
            <dd className="m-0 text-right font-bold">
              {event.location ? event.location.name : "À confirmer"}
              {address ? <span className="block text-[11px] font-normal text-muted">{address}</span> : null}
            </dd>
          </div>
        </dl>

        <section className="mt-6" aria-labelledby="a-propos">
          <h2 id="a-propos" className="text-panel-title font-bold">
            À propos
          </h2>
          {description.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">L'organisation n'a pas encore ajouté de description.</p>
          ) : (
            description.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static paragraphs
              <p key={i} className="mt-2 text-[13px]">
                {p}
              </p>
            ))
          )}
        </section>

        {programme.length > 0 ? (
          <section className="mt-6" aria-labelledby="programme">
            <h2 id="programme" className="text-panel-title font-bold">
              Programme
            </h2>
            {programme.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static paragraphs
              <p key={i} className="mt-2 text-[13px]">
                {p}
              </p>
            ))}
          </section>
        ) : null}

        {event.settings.accessInfo || event.location?.accessNotes || event.settings.contactEmail ? (
          <section className="mt-6" aria-labelledby="infos">
            <h2 id="infos" className="text-panel-title font-bold">
              Accès et accueil
            </h2>
            {event.location?.accessNotes ? <p className="mt-2 text-[13px]">{event.location.accessNotes}</p> : null}
            {event.settings.accessInfo ? (
              <p className="mt-2 whitespace-pre-line text-[13px]">{event.settings.accessInfo}</p>
            ) : null}
            {event.settings.contactEmail ? (
              <p className="mt-2 text-[13px]">
                Contact :{" "}
                <a href={`mailto:${event.settings.contactEmail}`} className="font-bold underline">
                  {event.settings.contactEmail}
                </a>
              </p>
            ) : null}
          </section>
        ) : null}

        <Panel className="mt-8 bg-lavender">
          {event.status === "published" && ticketing?.open ? (
            <>
              <p className="text-[13px] font-bold">Billetterie</p>
              <p className="mt-1 text-[13px]">
                {onSale.length === 0
                  ? "Aucun tarif en vente pour le moment."
                  : cheapest === 0
                    ? "Entrée gratuite sur réservation."
                    : `À partir de ${fmtMinor(cheapest ?? 0, ticketing.currency)} (hors frais de service).`}
              </p>
              <div className="mt-3">
                <Button asChild variant="primary">
                  <Link href={`/${event.organization.slug}/${event.slug}/billets`}>Choisir mes billets →</Link>
                </Button>
              </div>
            </>
          ) : event.status === "published" ? (
            <>
              <p className="text-[13px] font-bold">Billetterie</p>
              <p className="mt-1 text-[13px]">
                {ticketing?.closedReason ?? "La billetterie n'est pas encore ouverte."}
                {event.settings.externalUrl ? " L'organisation propose un lien externe." : ""}
              </p>
              {event.settings.externalUrl ? (
                <div className="mt-3">
                  <Button asChild variant="secondary">
                    <a href={event.settings.externalUrl} rel="noreferrer">
                      Lien de l'organisation ↗
                    </a>
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[13px]">Cet événement n'est plus ouvert.</p>
          )}
        </Panel>
      </article>
    </AppPublicShell>
  );
}
