import { getEventBySlug, listLocations } from "@kroov/domain/events";
import { NotFoundError } from "@kroov/domain/kernel";
import { ForbiddenState, PageHeader } from "@kroov/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { eventToForm } from "@/lib/event-form";
import { loadOrgPage } from "@/lib/org-context";
import { EventForm } from "../../event-form";

export const metadata: Metadata = { title: "Modifier l'événement" };

export default async function EditEventPage({ params }: { params: Promise<{ slug: string; eventSlug: string }> }) {
  const { slug, eventSlug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/evenements/${eventSlug}/modifier`);
  let event: Awaited<ReturnType<typeof getEventBySlug>>;
  try {
    event = await getEventBySlug(db(), ctx.session.actor, ctx.organization.id, eventSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (!ctx.can("events.update", event.id)) {
    return (
      <>
        <PageHeader eyebrow="Événements" title={event.title} />
        <ForbiddenState description="Vous pouvez consulter cet événement mais pas le modifier." />
      </>
    );
  }
  const locations = await listLocations(db(), ctx.session.actor, ctx.organization.id);
  return (
    <>
      <PageHeader
        eyebrow="Modifier"
        title={event.title}
        description={`Version ${event.version} · identifiant /${event.slug}`}
      />
      <EventForm
        organizationId={ctx.organization.id}
        slug={slug}
        locations={locations}
        initial={eventToForm(event)}
        event={{ id: event.id, version: event.version, status: event.status }}
      />
    </>
  );
}
