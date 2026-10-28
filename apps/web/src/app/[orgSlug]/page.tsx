import { getPublicOrganization, listPublicEvents } from "@kroov/domain/events";
import { formatDateFr, formatRangeFr, NotFoundError } from "@kroov/domain/kernel";
import { EmptyState, EventPoster, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  try {
    const org = await getPublicOrganization(db(), orgSlug);
    return { title: `${org.name} · Événements`, robots: { index: true, follow: true } };
  } catch {
    return { title: "Organisation introuvable" };
  }
}

/** Écran 26 — Découvrir les événements d'une organisation (lien direct, pas de marketplace). */
export default async function PublicOrganizationPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  let organization: Awaited<ReturnType<typeof getPublicOrganization>>;
  try {
    organization = await getPublicOrganization(db(), orgSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const events = await listPublicEvents(db(), organization.id);
  const now = Date.now();
  const upcoming = events.filter((e) => e.endsAt.getTime() > now);
  const past = events.filter((e) => e.endsAt.getTime() <= now);

  return (
    <AppPublicShell>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">{organization.name}</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">Les prochaines dates</h1>
        {organization.website || organization.contactEmail ? (
          <p className="mt-2 text-[13px] text-muted">
            {organization.website ? (
              <a href={organization.website} className="font-bold text-ink underline" rel="noreferrer">
                Site web
              </a>
            ) : null}
            {organization.website && organization.contactEmail ? " · " : ""}
            {organization.contactEmail ? (
              <a href={`mailto:${organization.contactEmail}`} className="font-bold text-ink underline">
                Contact
              </a>
            ) : null}
          </p>
        ) : null}

        {upcoming.length === 0 ? (
          <EmptyState
            className="mt-6"
            title="Aucun événement annoncé pour le moment"
            description="Revenez bientôt : les prochaines dates apparaîtront ici dès leur publication."
          />
        ) : (
          <ul className="m-0 mt-6 list-none space-y-4 p-0">
            {upcoming.map((e) => (
              <li key={e.slug}>
                <Link href={`/${organization.slug}/${e.slug}`} className="block rounded-panel">
                  <Panel className="transition-colors hover:border-ink">
                    <EventPoster
                      organizationName={organization.name}
                      title={e.title}
                      dateLabel={formatDateFr(e.startsAt, e.timezone)}
                      placeLabel={e.city ? `${e.city}${e.locationName ? ` · ${e.locationName}` : ""}` : undefined}
                      compact
                    />
                    <h2 className="mt-4 text-panel-title font-bold">{e.title}</h2>
                    {e.tagline ? <p className="text-[13px] text-muted">{e.tagline}</p> : null}
                    <p className="mt-2 text-[13px]">{formatRangeFr(e.startsAt, e.endsAt, e.timezone)}</p>
                  </Panel>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {past.length > 0 ? (
          <section className="mt-10" aria-labelledby="passes">
            <h2 id="passes" className="text-section-title font-black">
              Récemment
            </h2>
            <ul className="m-0 mt-3 list-none divide-y divide-border p-0 text-[13px]">
              {past.map((e) => (
                <li key={e.slug} className="py-3">
                  <Link href={`/${organization.slug}/${e.slug}`} className="font-bold underline underline-offset-4">
                    {e.title}
                  </Link>
                  <span className="block text-muted">{formatRangeFr(e.startsAt, e.endsAt, e.timezone)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AppPublicShell>
  );
}
