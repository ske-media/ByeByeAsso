import { listLocations } from "@kroov/domain/events";
import { ForbiddenState, PageHeader } from "@kroov/ui";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { emptyEventForm } from "@/lib/event-form";
import { loadOrgPage } from "@/lib/org-context";
import { EventForm } from "../event-form";

export const metadata: Metadata = { title: "Créer un événement" };

/** Écran 05 — Créer un événement. */
export default async function NewEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/evenements/nouveau`);
  if (!ctx.can("events.create")) {
    return (
      <>
        <PageHeader eyebrow="Événements" title="Créer un événement" />
        <ForbiddenState description="La création d'événements est réservée aux responsables événement et aux administrateurs." />
      </>
    );
  }
  const locations = await listLocations(db(), ctx.session.actor, ctx.organization.id);
  return (
    <>
      <PageHeader
        eyebrow="Événements"
        title="Créer un événement"
        description="Commencez par l'essentiel : le reste se complète avant la publication."
      />
      <EventForm
        organizationId={ctx.organization.id}
        slug={slug}
        locations={locations}
        initial={emptyEventForm(ctx.organization.timezone)}
      />
    </>
  );
}
