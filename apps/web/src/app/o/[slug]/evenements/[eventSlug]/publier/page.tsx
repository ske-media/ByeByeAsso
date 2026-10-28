import { getEventBySlug, publicationChecklist } from "@kroov/domain/events";
import { formatDateFr, formatRangeFr, NotFoundError } from "@kroov/domain/kernel";
import { Alert, Button, EventPoster, ForbiddenState, PageHeader, Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loadOrgPage } from "@/lib/org-context";
import { PublishButton } from "./publish-button";

export const metadata: Metadata = { title: "Publier l'événement" };

/** Écran 07 — Publication : relecture, check-list, action unique. */
export default async function PublishEventPage({ params }: { params: Promise<{ slug: string; eventSlug: string }> }) {
  const { slug, eventSlug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/evenements/${eventSlug}/publier`);
  let event: Awaited<ReturnType<typeof getEventBySlug>>;
  try {
    event = await getEventBySlug(db(), ctx.session.actor, ctx.organization.id, eventSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (event.status !== "draft") redirect(`/o/${slug}/evenements/${event.slug}`);
  if (!ctx.can("events.publish", event.id)) {
    return (
      <>
        <PageHeader eyebrow="Publication" title={event.title} />
        <ForbiddenState description="La publication est réservée aux personnes disposant du droit de publier cet événement." />
      </>
    );
  }
  const checklist = publicationChecklist(event);
  const missing = checklist.filter((c) => !c.ok);
  const publicUrl = `${env().APP_URL}/${ctx.organization.slug}/${event.slug}`;

  return (
    <>
      <PageHeader
        eyebrow="Publication"
        title="Relire avant de publier"
        description="Une fois publié, l'événement a une page publique. Vous pourrez encore le modifier."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <EventPoster
              organizationName={ctx.organization.name}
              title={event.title}
              dateLabel={formatDateFr(event.startsAt, event.timezone)}
              placeLabel={event.location ? `${event.location.city} · ${event.location.name}` : undefined}
            />
            <dl className="m-0 mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted">Quand</dt>
              <dd className="m-0 font-bold">{formatRangeFr(event.startsAt, event.endsAt, event.timezone)}</dd>
              <dt className="text-muted">Où</dt>
              <dd className="m-0 font-bold">
                {event.location ? `${event.location.name}, ${event.location.city}` : "Lieu à définir"}
              </dd>
              <dt className="text-muted">Capacité</dt>
              <dd className="m-0 font-bold">{event.capacity > 0 ? `${event.capacity} places` : "À définir"}</dd>
              <dt className="text-muted">Visibilité</dt>
              <dd className="m-0 font-bold">
                {event.visibility === "public" ? "Public (listé sur votre page)" : "Non répertorié (lien direct)"}
              </dd>
              <dt className="text-muted">Adresse</dt>
              <dd className="m-0 break-all font-bold">{publicUrl}</dd>
            </dl>
            {event.tagline ? <p className="mt-4 text-[13px]">{event.tagline}</p> : null}
            {event.description ? (
              <p className="mt-2 whitespace-pre-line text-[13px] text-muted">{event.description}</p>
            ) : null}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel className="bg-lavender">
            <PanelTitle>Check-list</PanelTitle>
            <ul className="m-0 list-none space-y-2 p-0 text-[13px]">
              {checklist.map((c) => (
                <li key={c.key} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${c.ok ? "bg-lime" : "border border-ink bg-surface"}`}
                  >
                    {c.ok ? "✓" : ""}
                  </span>
                  <span>
                    <span className="k-sr-only">{c.ok ? "Fait : " : "À faire : "}</span>
                    {c.label}
                    {!c.ok && c.hint ? <span className="block text-muted">{c.hint}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            {missing.length > 0 ? (
              <Alert tone="warning" heading="Publication impossible pour l'instant" className="mb-4">
                {missing.length} point(s) à compléter. Modifiez l'événement puis revenez ici.
              </Alert>
            ) : (
              <Alert tone="success" heading="Tout est prêt" className="mb-4">
                La page publique sera en ligne immédiatement après confirmation.
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <PublishButton
                organizationId={ctx.organization.id}
                slug={slug}
                eventId={event.id}
                eventSlug={event.slug}
                version={event.version}
                disabled={missing.length > 0}
              />
              <Button asChild variant="secondary">
                <Link href={`/o/${slug}/evenements/${event.slug}/modifier`}>Modifier</Link>
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
