import { contextHasPermission, loadMemberContext } from "@kroov/domain/authorization";
import { getEventBySlug } from "@kroov/domain/events";
import { NotFoundError } from "@kroov/domain/kernel";
import { getOrganizationForMember } from "@kroov/domain/organizations";
import { checkinSummary } from "@kroov/domain/ticketing";
import { ForbiddenState } from "@kroov/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Contrôle d'accès", robots: { index: false } };

/**
 * Écran 41 — Contrôle d'accès : expérience restreinte (coque dédiée, plein écran mobile),
 * réservée aux membres portant `checkins.scan` sur l'événement. Rien n'est révélé sinon.
 */
export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
  searchParams: Promise<{ onglet?: string }>;
}) {
  const { slug, eventSlug } = await params;
  const { onglet } = await searchParams;
  const session = await requireSession(`/controle/${slug}/${eventSlug}`);
  let organization: Awaited<ReturnType<typeof getOrganizationForMember>>;
  try {
    organization = await getOrganizationForMember(db(), session.actor, slug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const member = await loadMemberContext(db(), session.user.id, organization.id);
  if (!member) notFound();
  let event: Awaited<ReturnType<typeof getEventBySlug>>;
  try {
    event = await getEventBySlug(db(), session.actor, organization.id, eventSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (!contextHasPermission(member, "checkins.scan", { organizationId: organization.id, eventId: event.id })) {
    return (
      <AppPublicShell>
        <div className="py-10">
          <ForbiddenState description="Le contrôle d'accès est réservé aux contrôleurs désignés pour cet événement." />
        </div>
      </AppPublicShell>
    );
  }
  const summary = await checkinSummary(db(), session.actor, organization.id, event.id);
  const tab = onglet === "journal" ? "journal" : "scanner";
  return (
    <Scanner
      organizationId={organization.id}
      eventId={event.id}
      eventTitle={event.title}
      organizationName={organization.name}
      userName={session.user.name}
      timezone={event.timezone}
      initial={{
        admitted: summary.admitted,
        valid: summary.valid,
        recent: summary.recent.map((r) => ({ ...r, at: r.at.toISOString() })),
      }}
      slug={slug}
      eventSlug={eventSlug}
      tab={tab}
    />
  );
}
