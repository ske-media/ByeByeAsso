import { getEventBySlug } from "@kroov/domain/events";
import { formatDateFr, formatRangeFr, formatTimeFr, NotFoundError } from "@kroov/domain/kernel";
import {
  diffVersions,
  getVersion,
  listRequests,
  listVersions,
  SCHEDULE_VERSION_STATUS_LABELS,
} from "@kroov/domain/scheduling";
import { Badge, Button, ForbiddenState, PageHeader, Panel, PanelTitle, Stat, StatGrid } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { PublishPanel, RequestsPanel, ScheduleGrid, VersionActions } from "./planning-panels";

export const metadata: Metadata = { title: "Planning" };

const STATUS_TONE: Record<string, "lime" | "orange" | "neutral" | "error" | "lavender"> = {
  draft: "neutral",
  generating: "orange",
  generation_failed: "error",
  proposed: "lavender",
  under_review: "orange",
  published: "lime",
  superseded: "neutral",
};

/** Écrans 14–16 — proposition, arbitrage, validation humaine et publication. */
export default async function PlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { slug, eventSlug } = await params;
  const sp = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/evenements/${eventSlug}/planning`);
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
        <PageHeader eyebrow="Planning" title={event.title} />
        <ForbiddenState description="Le planning est réservé aux responsables bénévoles, événement et aux administrateurs." />
      </>
    );
  }
  const actor = ctx.session.actor;
  const tz = event.timezone;
  const versions = await listVersions(db(), actor, ctx.organization.id, event.id);
  const published = versions.find((v) => v.status === "published") ?? null;
  const selectedId =
    sp.version && versions.some((v) => v.id === sp.version)
      ? sp.version
      : (versions.find((v) => v.status !== "superseded")?.id ?? versions[0]?.id ?? null);
  const [detail, requests] = await Promise.all([
    selectedId ? getVersion(db(), actor, ctx.organization.id, selectedId) : Promise.resolve(null),
    listRequests(db(), actor, ctx.organization.id, event.id),
  ]);
  const diff =
    detail && published && published.id !== detail.id
      ? await diffVersions(db(), actor, ctx.organization.id, detail.id, published.id)
      : [];
  const panelCtx = {
    organizationId: ctx.organization.id,
    slug,
    eventId: event.id,
    eventSlug,
    canSchedule: ctx.can("volunteers.schedule", event.id),
    canPublish: ctx.can("schedules.publish", event.id),
  };
  const editable = detail ? ["draft", "proposed", "under_review", "generation_failed"].includes(detail.status) : false;
  const unfilledCount = detail?.unfilled.reduce((n, u) => n + u.missing, 0) ?? 0;
  return (
    <>
      <PageHeader
        eyebrow={`Planning · ${event.title}`}
        title={detail ? `Planning ${detail.label}` : "Pas encore de planning."}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {detail ? (
              <Badge tone={STATUS_TONE[detail.status] ?? "neutral"}>
                {SCHEDULE_VERSION_STATUS_LABELS[detail.status]}
              </Badge>
            ) : null}
            <span>{formatRangeFr(event.startsAt, event.endsAt, tz)}</span>
            {published ? (
              <span>· version qui fait foi : {published.label}</span>
            ) : (
              <span>· aucune version publiée</span>
            )}
          </span>
        }
        actions={
          <Button asChild variant="secondary">
            <Link href={`/o/${slug}/evenements/${eventSlug}/benevoles`}>Postes et besoins</Link>
          </Button>
        }
      />
      <StatGrid>
        <Stat
          tone={detail && detail.coveredCount >= detail.requiredTotal ? "lime" : "orange"}
          label="Affectations couvertes"
          value={String(detail?.coveredCount ?? 0)}
          unit={`/ ${detail?.requiredTotal ?? 0}`}
          hint="Requis sur les créneaux actifs — distinct des personnes"
        />
        <Stat
          label="Personnes affectées"
          value={String(detail?.volunteers.filter((v) => v.assignments > 0).length ?? 0)}
          hint={`${detail?.volunteers.length ?? 0} bénévole(s) acceptée(s)`}
        />
        <Stat
          tone={detail && detail.conflicts.length > 0 ? "orange" : "lime"}
          label="Conflits bloquants"
          value={String(detail?.conflicts.length ?? 0)}
          hint="Revérifiés sur les données actuelles"
        />
        <Stat
          tone={requests.length > 0 ? "orange" : "lavender"}
          label="Demandes d'arbitrage"
          value={String(requests.length)}
          hint="Indisponibilités signalées après publication"
        />
      </StatGrid>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelTitle>Versions</PanelTitle>
            {versions.length === 0 ? (
              <p className="text-[13px] text-muted">
                Créez une première version : le moteur propose, vous arbitrez, puis vous publiez.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {versions.map((v) => (
                  <li key={v.id}>
                    <Link
                      href={`/o/${slug}/evenements/${eventSlug}/planning?version=${v.id}`}
                      aria-current={v.id === selectedId ? "page" : undefined}
                      className={`inline-flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[13px] ${v.id === selectedId ? "border-ink bg-lime" : "border-border"}`}
                    >
                      <b>{v.label}</b>
                      <Badge tone={STATUS_TONE[v.status] ?? "neutral"} noDot>
                        {SCHEDULE_VERSION_STATUS_LABELS[v.status]}
                      </Badge>
                      <span className="text-[11px] text-muted">
                        {v.coveredCount}/{v.requiredTotal}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <VersionActions
                ctx={panelCtx}
                versionId={detail?.id ?? null}
                status={detail?.status ?? null}
                editable={editable}
                basedOnPublishedId={published?.id ?? null}
              />
            </div>
            {detail?.lastRun ? (
              <p className="mt-3 text-[12px] text-muted">
                Dernière exécution : {detail.lastRun.algorithmVersion} ·{" "}
                {detail.lastRun.solverStatus ?? detail.lastRun.status} · {detail.lastRun.durationMs ?? 0} ms · empreinte{" "}
                {detail.lastRun.inputHash.slice(0, 12)}… · score{" "}
                {typeof detail.lastRun.score === "object" && detail.lastRun.score
                  ? String((detail.lastRun.score as { total?: number }).total ?? "")
                  : "—"}
                {detail.lastRun.scope ? ` · régénération partielle (${detail.lastRun.scope.length} créneau(x))` : ""}
              </p>
            ) : null}
            {detail && detail.invalidLocks.length > 0 ? (
              <p className="mt-2 text-[12px] text-error-text">
                Verrous ignorés par le moteur (devenus invalides) :{" "}
                {detail.invalidLocks.map((l) => l.label).join(" · ")}
              </p>
            ) : null}
          </Panel>

          {detail ? (
            <Panel>
              <PanelTitle>Créneaux et affectations</PanelTitle>
              {detail.unfilled.length > 0 ? (
                <p className="mb-2 text-[12px] text-muted">
                  Non pourvus :{" "}
                  {detail.unfilled
                    .map((u) => `${u.positionName}${u.label ? ` · ${u.label}` : ""} (${u.missing})`)
                    .join(" ; ")}
                  .
                </p>
              ) : null}
              <ScheduleGrid
                ctx={panelCtx}
                versionId={detail.id}
                editable={editable}
                published={detail.status === "published"}
                slots={detail.shifts.map((s) => ({
                  shiftId: s.shiftId,
                  positionName: s.positionName,
                  teamName: s.teamName,
                  label: s.label,
                  rangeLabel: formatRangeFr(s.startsAt, s.endsAt, tz),
                  requiredCount: s.requiredCount,
                  maxCount: s.maxCount,
                  missing: s.missing,
                  assignments: s.assignments.map((a) => ({
                    id: a.id,
                    applicationId: a.applicationId,
                    volunteerName: a.volunteerName,
                    source: a.source,
                    locked: a.locked,
                    confirmationStatus: a.confirmationStatus,
                    openRequest: a.openRequest
                      ? { id: a.openRequest.id, kind: a.openRequest.kind, message: a.openRequest.message }
                      : null,
                    attendance: a.attendance,
                    conflict: detail.conflicts.find((c) => c.assignmentId === a.id)?.label ?? null,
                  })),
                  candidates: s.candidates,
                  excluded: s.excluded.map((e) => ({ applicationId: e.applicationId, name: e.name, label: e.label })),
                }))}
              />
            </Panel>
          ) : null}
        </div>
        <div className="space-y-5">
          {detail ? (
            <Panel className={detail.status === "published" ? "bg-lime" : "bg-lavender"}>
              <PanelTitle>{detail.status === "published" ? "Version publiée" : "Validation humaine"}</PanelTitle>
              <PublishPanel
                ctx={panelCtx}
                versionId={detail.id}
                versionLabel={detail.label}
                versionToken={detail.version}
                status={detail.status}
                blockers={detail.publishBlockers}
                unfilledCount={unfilledCount}
                openRequests={requests.length}
              />
              {detail.publishedAt ? (
                <p className="mt-2 text-[12px] text-muted">
                  Publiée le {formatDateFr(detail.publishedAt, tz)} à {formatTimeFr(detail.publishedAt, tz)}
                  {detail.unfilledAcknowledged ? " · avec besoins non pourvus assumés" : ""}.
                </p>
              ) : null}
              {detail.notes ? <p className="mt-1 text-[12px]">{detail.notes}</p> : null}
            </Panel>
          ) : null}
          {detail && published && published.id !== detail.id ? (
            <Panel>
              <PanelTitle>Différentiel avec {published.label}</PanelTitle>
              {diff.length === 0 ? (
                <p className="text-[13px] text-muted">Aucune différence avec la version publiée.</p>
              ) : (
                <ul className="m-0 list-none space-y-1 p-0 text-[13px]">
                  {diff.map((d) => (
                    <li key={`${d.change}-${d.shiftId}-${d.applicationId}`}>
                      <Badge tone={d.change === "added" ? "lime" : "error"} noDot>
                        {d.change === "added" ? "Ajout" : "Retrait"}
                      </Badge>{" "}
                      {d.volunteerName} — {d.positionName}
                      {d.label ? ` · ${d.label}` : ""} ({formatRangeFr(d.startsAt, d.endsAt, tz)})
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
          <Panel>
            <PanelTitle>Demandes d'arbitrage</PanelTitle>
            <RequestsPanel
              ctx={panelCtx}
              requests={requests.map((r) => ({
                id: r.id,
                volunteerName: r.volunteerName,
                positionName: r.positionName,
                label: r.label,
                rangeLabel: formatRangeFr(r.startsAt, r.endsAt, tz),
                message: r.message,
                createdLabel: formatDateFr(r.createdAt, tz),
              }))}
            />
          </Panel>
          {detail ? (
            <Panel>
              <PanelTitle>Charge par bénévole</PanelTitle>
              <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
                {detail.volunteers.map((v) => (
                  <li key={v.applicationId} className="flex justify-between py-1">
                    <Link
                      href={`/o/${slug}/benevoles/candidatures/${v.applicationId}`}
                      className="underline underline-offset-4"
                    >
                      {v.name}
                    </Link>
                    <span className="text-muted">
                      {v.assignments} mission(s) · {v.hours} h
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted">
                Règles de l'événement : {event.title} — les contraintes dures (disponibilité, chevauchement, repos,
                heures max., compétences obligatoires, effectif) ne sont jamais contournées ; vœux et binômes sont des
                préférences.
              </p>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
