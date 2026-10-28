import { listEvents } from "@kroov/domain/events";
import { formatDateFr } from "@kroov/domain/kernel";
import {
  applicationStats,
  listApplications,
  listPositions,
  listSkills,
  listTeams,
  type VolunteerApplicationStatus,
} from "@kroov/domain/volunteers";
import { EmptyState, ForbiddenState, PageHeader, Panel, PanelTitle, Stat, StatGrid } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { ApplicationsTable } from "./applications-table";
import { SkillsPanel, TeamsAndPositionsPanel } from "./catalogue-panels";
import { VolunteersFilters, type VolunteersTab } from "./filters";

export const metadata: Metadata = { title: "Bénévoles" };

const STATUS_VALUES = new Set<string>([
  "all",
  "to_review",
  "submitted",
  "under_review",
  "approved",
  "waitlisted",
  "rejected",
  "assigned",
  "confirmed",
  "withdrawn",
]);

/** Écran 11 — Bénévoles et candidatures : indicateurs, liste filtrable, traitement en lot, catalogue. */
export default async function VolunteersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    evenement?: string;
    statut?: string;
    poste?: string;
    competence?: string;
    q?: string;
    onglet?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/benevoles`);
  const scopedEvents = [...ctx.member.eventPermissions.entries()]
    .filter(([, p]) => p.has("volunteers.review"))
    .map(([id]) => id);
  const canReview = ctx.can("volunteers.review") || scopedEvents.length > 0;
  if (!canReview) {
    return (
      <>
        <PageHeader eyebrow="Bénévoles" title="Des mains et des cœurs." />
        <ForbiddenState description="Les candidatures bénévoles sont réservées aux responsables bénévoles, événement et aux administrateurs." />
      </>
    );
  }
  const actor = ctx.session.actor;
  const org = ctx.organization;
  const orgWide = ctx.can("volunteers.review");
  const tab: VolunteersTab =
    sp.onglet === "equipes" ? "equipes" : sp.onglet === "competences" ? "competences" : "candidatures";
  const events = (await listEvents(db(), actor, org.id, { status: "all" })).filter(
    (e) => orgWide || scopedEvents.includes(e.id),
  );
  const eventId = sp.evenement && events.some((e) => e.id === sp.evenement) ? sp.evenement : undefined;
  const status = (STATUS_VALUES.has(sp.statut ?? "") ? sp.statut : "all") as
    | "all"
    | "to_review"
    | VolunteerApplicationStatus;
  const [skills, teams, positions, stats] = await Promise.all([
    orgWide ? listSkills(db(), actor, org.id) : Promise.resolve([]),
    orgWide ? listTeams(db(), actor, org.id) : Promise.resolve([]),
    orgWide ? listPositions(db(), actor, org.id) : Promise.resolve([]),
    applicationStats(db(), actor, org.id, eventId),
  ]);
  const positionId = sp.poste && positions.some((p) => p.id === sp.poste) ? sp.poste : undefined;
  const skillId = sp.competence && skills.some((s) => s.id === sp.competence) ? sp.competence : undefined;
  const applications =
    tab === "candidatures"
      ? await listApplications(db(), actor, org.id, {
          status,
          ...(eventId ? { eventId } : {}),
          ...(positionId ? { positionId } : {}),
          ...(skillId ? { skillId } : {}),
          ...(sp.q ? { q: sp.q } : {}),
        })
      : [];
  const panelCtx = { organizationId: org.id, slug };

  return (
    <>
      <PageHeader
        eyebrow="Bénévoles"
        title="Des mains et des cœurs."
        description={
          eventId
            ? (events.find((e) => e.id === eventId)?.title ?? "")
            : "Candidatures, équipes, postes et compétences de l'organisation."
        }
      />
      <StatGrid>
        <Stat
          tone="lime"
          label="Personnes acceptées"
          value={String(stats.approved)}
          unit={stats.target > 0 ? `/ ${stats.target}` : undefined}
          hint={stats.target > 0 ? "Objectif de l'événement" : "Aucun objectif fixé"}
        />
        <Stat tone="orange" label="À examiner" value={String(stats.toReview)} hint="Reçues ou à l'étude" />
        <Stat
          tone="lavender"
          label="Liste d'attente"
          value={String(stats.waitlisted)}
          hint="Peuvent élargir leurs vœux"
        />
        <Stat
          label="Affectations à couvrir"
          value={String(stats.requiredTotal)}
          hint="Somme des effectifs requis sur les créneaux — distinct des personnes"
        />
      </StatGrid>

      <VolunteersFilters
        slug={slug}
        events={events.map((e) => ({ id: e.id, title: e.title }))}
        skills={skills.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name }))}
        positions={positions.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name }))}
        eventId={eventId ?? ""}
        status={status}
        positionId={positionId ?? ""}
        skillId={skillId ?? ""}
        q={sp.q ?? ""}
        tab={orgWide ? tab : "candidatures"}
      />

      {tab === "candidatures" || !orgWide ? (
        <Panel>
          <PanelTitle>Candidatures</PanelTitle>
          {applications.length === 0 ? (
            <EmptyState
              title="Aucune candidature"
              description={
                sp.q || status !== "all" || positionId || skillId
                  ? "Aucune candidature ne correspond à ce filtre."
                  : "Ouvrez le recrutement depuis la page « Bénévoles » d'un événement : les candidatures arriveront ici."
              }
            />
          ) : (
            <ApplicationsTable
              organizationId={org.id}
              slug={slug}
              showEvent={!eventId}
              rows={applications.map((a) => ({
                id: a.id,
                number: a.number,
                status: a.status,
                name: `${a.firstName} ${a.lastName}`,
                email: a.email,
                eventTitle: a.eventTitle,
                firstChoice: a.firstChoice,
                skillsCount: a.skillsCount,
                verifiedSkillsCount: a.verifiedSkillsCount,
                effectiveHours: a.effectiveHours,
                receivedLabel: formatDateFr(a.createdAt, org.timezone),
              }))}
            />
          )}
          {events.length > 0 ? (
            <p className="mt-3 text-[12px] text-muted">
              Postes et créneaux par événement :{" "}
              {events.slice(0, 4).map((e, i) => (
                <span key={e.id}>
                  {i > 0 ? " · " : ""}
                  <Link href={`/o/${slug}/evenements/${e.slug}/benevoles`} className="underline underline-offset-4">
                    {e.title}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
        </Panel>
      ) : tab === "equipes" ? (
        <TeamsAndPositionsPanel ctx={panelCtx} teams={teams} positions={positions} skills={skills} />
      ) : (
        <SkillsPanel ctx={panelCtx} skills={skills} />
      )}
    </>
  );
}
