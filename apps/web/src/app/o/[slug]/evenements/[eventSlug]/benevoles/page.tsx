import { getEventBySlug } from "@kroov/domain/events";
import {
  formatRangeFr,
  instantToWallClock,
  NotFoundError,
  wallClockDateString,
  wallClockTimeString,
} from "@kroov/domain/kernel";
import { applicationStats, availabilityMatrix, getVolunteering, listPositions } from "@kroov/domain/volunteers";
import {
  Badge,
  Button,
  ForbiddenState,
  PageHeader,
  Panel,
  PanelTitle,
  Stat,
  StatGrid,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { CoverageBadge, PositionsPanel, RecruitmentControl, SettingsForm } from "./staffing-panels";

export const metadata: Metadata = { title: "Bénévoles de l'événement" };

/** Écran 13 — Postes et besoins : recrutement, réglages, postes activés, créneaux, matrice de disponibilité. */
export default async function EventVolunteeringPage({
  params,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
}) {
  const { slug, eventSlug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/evenements/${eventSlug}/benevoles`);
  let event: Awaited<ReturnType<typeof getEventBySlug>>;
  try {
    event = await getEventBySlug(db(), ctx.session.actor, ctx.organization.id, eventSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (!ctx.can("volunteers.review", event.id)) {
    return (
      <>
        <PageHeader eyebrow="Bénévoles" title={event.title} />
        <ForbiddenState description="Les besoins en bénévoles sont réservés aux responsables bénévoles, événement et aux administrateurs." />
      </>
    );
  }
  const actor = ctx.session.actor;
  const canSchedule = ctx.can("volunteers.schedule", event.id);
  const [view, stats, matrix, templates] = await Promise.all([
    getVolunteering(db(), actor, ctx.organization.id, event.id),
    applicationStats(db(), actor, ctx.organization.id, event.id),
    availabilityMatrix(db(), actor, ctx.organization.id, event.id),
    ctx.can("volunteers.review") ? listPositions(db(), actor, ctx.organization.id) : Promise.resolve([]),
  ]);
  const tz = event.timezone;
  const wall = (d: Date) => {
    const w = instantToWallClock(d, tz);
    return { date: wallClockDateString(w), time: wallClockTimeString(w) };
  };
  const activePositions = view.positions.filter((p) => p.status === "active");
  const blockers: string[] = [];
  if (activePositions.length === 0) blockers.push("Activez au moins un poste.");
  if (!["draft", "published"].includes(event.status)) blockers.push("L'événement doit être en préparation ou publié.");
  if (event.status !== "published")
    blockers.push("Publiez l'événement pour que la page de candidature soit accessible.");
  const panelCtx = {
    organizationId: ctx.organization.id,
    slug,
    eventId: event.id,
    eventSlug,
    timezone: tz,
    canSchedule,
  };
  return (
    <>
      <PageHeader
        eyebrow={`Bénévoles · ${event.title}`}
        title="Postes et besoins."
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={view.recruitmentStatus === "open" ? "lime" : "neutral"}>
              {view.recruitmentStatus === "open" ? "Recrutement ouvert" : "Recrutement fermé"}
            </Badge>
            <span>{formatRangeFr(event.startsAt, event.endsAt, tz)}</span>
            {event.status === "published" ? (
              <Link href={`/${slug}/${eventSlug}/benevoles`} className="underline underline-offset-4">
                page publique
              </Link>
            ) : null}
          </span>
        }
        actions={
          <span className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href={`/o/${slug}/benevoles?evenement=${event.id}`}>Candidatures</Link>
            </Button>
            <Button asChild variant="primary">
              <Link href={`/o/${slug}/evenements/${event.slug}/planning`}>Planning →</Link>
            </Button>
          </span>
        }
      />
      <StatGrid>
        <Stat
          tone="lime"
          label="Personnes acceptées"
          value={String(stats.approved)}
          unit={view.targetCount > 0 ? `/ ${view.targetCount}` : undefined}
          hint="Objectif de l'événement"
        />
        <Stat
          label="Affectations à couvrir"
          value={String(view.requiredTotal)}
          hint="Somme des effectifs requis des créneaux"
        />
        <Stat tone="orange" label="À examiner" value={String(stats.toReview)} hint="Candidatures reçues ou à l'étude" />
        <Stat
          tone="lavender"
          label="Créneaux actifs"
          value={String(matrix.shifts.length)}
          hint={`${activePositions.length} poste(s) activé(s)`}
        />
      </StatGrid>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelTitle>Postes activés et créneaux</PanelTitle>
            <PositionsPanel
              ctx={panelCtx}
              eventPositions={view.positions.map((p) => ({
                id: p.id,
                positionId: p.positionId,
                name: p.name,
                teamName: p.teamName,
                skills: p.skills.map((s) => ({ name: s.name, mandatory: s.mandatory })),
                status: p.status,
                requiredTotal: p.requiredTotal,
                shifts: p.shifts.map((s) => {
                  const st = wall(s.startsAt);
                  const en = wall(s.endsAt);
                  return {
                    id: s.id,
                    label: s.label,
                    startsDate: st.date,
                    startsTime: st.time,
                    endsDate: en.date,
                    endsTime: en.time,
                    rangeLabel: formatRangeFr(s.startsAt, s.endsAt, tz),
                    requiredCount: s.requiredCount,
                    maxCount: s.maxCount,
                    notes: s.notes,
                    status: s.status,
                  };
                }),
              }))}
              availableTemplates={templates
                .filter((t) => t.status === "active" && !activePositions.some((p) => p.positionId === t.id))
                .map((t) => ({ id: t.id, name: t.name, teamName: t.teamName }))}
            />
          </Panel>

          <Panel>
            <PanelTitle>Matrice de disponibilité</PanelTitle>
            <p className="text-[12px] text-muted">
              Bénévoles acceptés (et en liste d'attente, en italique) × créneaux. ✓ disponible sur tout le créneau, ◐ en
              partie, — indisponible. Le planning n'affecte que les ✓.
            </p>
            {matrix.shifts.length === 0 || matrix.volunteers.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">
                {matrix.shifts.length === 0
                  ? "Définissez des créneaux pour projeter les disponibilités."
                  : "Aucun bénévole accepté pour l'instant."}
              </p>
            ) : (
              <TableContainer label="Matrice de disponibilité" className="mt-3 border-0 bg-transparent">
                <Table>
                  <THead>
                    <TR>
                      <TH>Bénévole</TH>
                      {matrix.shifts.map((s) => (
                        <TH key={s.id}>
                          {s.positionName}
                          <span className="block text-[10px] font-normal text-muted">
                            {s.label ? `${s.label} · ` : ""}
                            {formatRangeFr(s.startsAt, s.endsAt, tz)}
                          </span>
                          <span className="block text-[10px] font-normal text-muted">
                            {matrix.availablePerShift[s.id] ?? 0} dispo. / {s.requiredCount} requis
                          </span>
                        </TH>
                      ))}
                      <TH>Heures</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {matrix.volunteers.map((v) => (
                      <TR key={v.id}>
                        <TD className={v.status === "waitlisted" ? "italic text-muted" : ""}>
                          <Link
                            href={`/o/${slug}/benevoles/candidatures/${v.id}`}
                            className="underline underline-offset-4"
                          >
                            {v.name}
                          </Link>
                        </TD>
                        {matrix.shifts.map((s) => (
                          <TD key={s.id} className="text-center">
                            <CoverageBadge coverage={v.coverage[s.id] ?? "none"} />
                          </TD>
                        ))}
                        <TD>{v.effectiveHours} h</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel className="bg-lime">
            <PanelTitle>Recrutement</PanelTitle>
            <p className="text-[13px]">
              {view.recruitmentStatus === "open"
                ? "Les candidatures sont ouvertes sur la page publique de l'événement."
                : "Fermé : la page publique n'accepte pas de candidature."}
            </p>
            <div className="mt-3">
              <RecruitmentControl ctx={panelCtx} status={view.recruitmentStatus} blockers={blockers} />
            </div>
          </Panel>
          <Panel>
            <PanelTitle>Réglages et questions</PanelTitle>
            <SettingsForm
              ctx={panelCtx}
              initial={{
                targetCount: view.targetCount,
                maxHoursPerDay: view.maxHoursPerDay,
                minRestMinutes: view.minRestMinutes,
                questions: view.questions.map((q) => ({
                  uid: q.id,
                  label: q.label,
                  type: q.type,
                  required: q.required,
                  options: q.options,
                })),
              }}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}
