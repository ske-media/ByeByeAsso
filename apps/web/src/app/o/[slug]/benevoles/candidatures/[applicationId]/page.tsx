import { formatDateFr, formatRangeFr, formatTimeFr } from "@kroov/domain/kernel";
import {
  getApplication,
  loadEventPositionsUnchecked,
  VOLUNTEER_APPLICATION_STATUS_LABELS,
} from "@kroov/domain/volunteers";
import { Badge, Button, ForbiddenState, PageHeader, Panel, PanelTitle, Person } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { APPLICATION_STATUS_TONE } from "../../status-tone";
import { DecisionsPanel, InternalNotesForm, StaffEditForm, VerifySkillButton } from "./review-panels";

export const metadata: Metadata = { title: "Candidature" };

const COVERAGE_LABEL = { full: "Disponible", partial: "Partiellement", none: "Indisponible" } as const;
const COVERAGE_TONE = { full: "lime", partial: "orange", none: "neutral" } as const;

/** Écran 12 — Examiner une candidature : fiche, vœux ↔ compétences, disponibilités projetées, notes, décisions. */
export default async function ReviewApplicationPage({
  params,
}: {
  params: Promise<{ slug: string; applicationId: string }>;
}) {
  const { slug, applicationId } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/benevoles/candidatures/${applicationId}`);
  const canReviewAny =
    ctx.can("volunteers.review") || [...ctx.member.eventPermissions.values()].some((p) => p.has("volunteers.review"));
  if (!canReviewAny) {
    return (
      <>
        <PageHeader eyebrow="Bénévoles" title="Candidature" />
        <ForbiddenState description="L'examen des candidatures est réservé aux responsables bénévoles, événement et aux administrateurs." />
      </>
    );
  }
  let a: Awaited<ReturnType<typeof getApplication>>;
  try {
    a = await getApplication(db(), ctx.session.actor, ctx.organization.id, applicationId);
  } catch {
    notFound();
  }
  const tz = a.event.timezone;
  const when = (d: Date) => `${formatDateFr(d, tz)}, ${formatTimeFr(d, tz)}`;
  const eventPositions = await loadEventPositionsUnchecked(db(), ctx.organization.id, a.event.id);
  const panelCtx = { organizationId: ctx.organization.id, slug, applicationId: a.id };
  const closed = a.status === "rejected" || a.status === "withdrawn";
  return (
    <>
      <PageHeader
        eyebrow={`Bénévoles · ${a.event.title}`}
        title={`${a.firstName} ${a.lastName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={APPLICATION_STATUS_TONE[a.status]}>{VOLUNTEER_APPLICATION_STATUS_LABELS[a.status]}</Badge>
            <span>
              {a.number} · reçue le {formatDateFr(a.createdAt, tz)}
              {a.reviewedAt ? ` · revue le ${formatDateFr(a.reviewedAt, tz)}` : ""}
            </span>
          </span>
        }
        actions={
          <Button asChild variant="secondary">
            <Link href={`/o/${slug}/benevoles?evenement=${a.event.id}`}>← Candidatures</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelTitle>Candidat·e</PanelTitle>
            <Person name={`${a.firstName} ${a.lastName}`} secondary={a.email} tone="lavender" />
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-muted">Téléphone</dt>
                <dd>{a.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Année de naissance</dt>
                <dd>{a.birthYear ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">Motivation</dt>
                <dd className="whitespace-pre-line">{a.motivation ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">Expérience et qualifications</dt>
                <dd className="whitespace-pre-line">{a.experience ?? "—"}</dd>
              </div>
              {a.constraints ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted">Contraintes</dt>
                  <dd className="whitespace-pre-line">{a.constraints}</dd>
                </div>
              ) : null}
              {a.answers.map((ans) => (
                <div key={ans.key}>
                  <dt className="text-muted">{ans.label}</dt>
                  <dd>{typeof ans.value === "boolean" ? (ans.value ? "Oui" : "Non") : String(ans.value)}</dd>
                </div>
              ))}
              {a.decisionReason ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted">Motif communiqué</dt>
                  <dd>{a.decisionReason}</dd>
                </div>
              ) : null}
            </dl>
          </Panel>

          <Panel>
            <PanelTitle>Vœux et compétences requises</PanelTitle>
            {a.preferences.length === 0 ? (
              <p className="text-[13px] text-muted">Aucun vœu.</p>
            ) : (
              <ol className="m-0 list-none space-y-2 p-0 text-[13px]">
                {a.preferences.map((p) => (
                  <li key={p.positionId} className="rounded-[9px] border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <b>
                          {p.rank}. {p.positionName}
                        </b>
                        <span className="text-muted"> · {p.teamName}</span>
                        {!p.active ? (
                          <span className="ml-2 text-[11px] text-muted">(poste retiré de l'événement)</span>
                        ) : null}
                      </span>
                      <Badge tone={p.eligible ? "lime" : "orange"} noDot>
                        {p.eligible ? "Éligible" : "Qualification manquante"}
                      </Badge>
                    </div>
                    {p.requirements.length > 0 ? (
                      <ul className="m-0 mt-1 list-none p-0 text-[12px]">
                        {p.requirements.map((r) => (
                          <li key={r.skillId}>
                            {r.satisfied ? "✓" : r.declared ? "◐" : "✗"} {r.name}
                            {r.mandatory ? " (obligatoire)" : " (souhaitée)"}
                            {r.declared && !r.satisfied ? " — déclarée, vérification requise" : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel>
            <PanelTitle>Compétences déclarées</PanelTitle>
            {a.skills.length === 0 ? (
              <p className="text-[13px] text-muted">Aucune compétence déclarée.</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
                {a.skills.map((s) => (
                  <li key={s.skillId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <b>{s.name}</b>
                      {s.level ? (
                        <span className="text-muted">
                          {" "}
                          · {{ beginner: "débutant", intermediate: "intermédiaire", expert: "confirmé" }[s.level]}
                        </span>
                      ) : null}
                      {s.requiresVerification ? (
                        <Badge tone={s.verified ? "lime" : "orange"} noDot className="ml-2">
                          {s.verified
                            ? `Vérifiée${s.verifiedAt ? ` le ${formatDateFr(s.verifiedAt, tz)}` : ""}`
                            : "À vérifier"}
                        </Badge>
                      ) : null}
                    </span>
                    {s.requiresVerification && !closed ? (
                      <VerifySkillButton ctx={panelCtx} skillId={s.skillId} verified={s.verified} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelTitle>Disponibilités</PanelTitle>
            <p className="text-[12px] text-muted">
              {a.effectiveHours} h disponibles au total · {formatRangeFr(a.event.startsAt, a.event.endsAt, tz)}
            </p>
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[13px]">
              {a.availabilities.map((r) => (
                <li key={r.id}>
                  <Badge tone={r.kind === "available" ? "lime" : "neutral"} noDot>
                    {r.kind === "available" ? "Disponible" : "Indisponible"}
                  </Badge>{" "}
                  {when(r.startsAt)} → {when(r.endsAt)}
                  {r.note ? <span className="text-muted"> · {r.note}</span> : null}
                </li>
              ))}
            </ul>
            {a.shiftCoverage.length > 0 ? (
              <>
                <p className="mt-3 text-[12px] font-bold">Projection sur les créneaux</p>
                <ul className="m-0 mt-1 list-none divide-y divide-border p-0 text-[13px]">
                  {a.shiftCoverage.map((s) => (
                    <li key={s.shiftId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>
                        <b>{s.positionName}</b>
                        {s.label ? ` · ${s.label}` : ""}
                        <span className="block text-[11px] text-muted">{formatRangeFr(s.startsAt, s.endsAt, tz)}</span>
                      </span>
                      <Badge tone={COVERAGE_TONE[s.coverage]} noDot>
                        {COVERAGE_LABEL[s.coverage]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-2 text-[12px] text-muted">Aucun créneau défini sur l'événement pour l'instant.</p>
            )}
          </Panel>

          <Panel>
            <PanelTitle>Binôme souhaité</PanelTitle>
            {a.buddies.length === 0 ? (
              <p className="text-[13px] text-muted">Aucun binôme demandé.</p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0 text-[13px]">
                {a.buddies.map((b) => (
                  <li key={b.email}>
                    {b.targetName ? (
                      <Link
                        href={`/o/${slug}/benevoles/candidatures/${b.targetApplicationId}`}
                        className="font-bold underline underline-offset-4"
                      >
                        {b.targetName}
                      </Link>
                    ) : (
                      <b>{b.email}</b>
                    )}
                    {b.targetStatus ? (
                      <span className="text-muted"> · {VOLUNTEER_APPLICATION_STATUS_LABELS[b.targetStatus]}</span>
                    ) : (
                      <span className="text-muted"> · n'a pas candidaté</span>
                    )}
                    <Badge tone={b.reciprocal ? "lime" : "neutral"} noDot className="ml-2">
                      {b.reciprocal ? "Réciproque" : "Non réciproque"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-muted">
              Préférence souple : elle n'empêche aucune décision ni affectation.
            </p>
          </Panel>

          <Panel>
            <PanelTitle>Modifier la candidature</PanelTitle>
            <StaffEditForm
              ctx={panelCtx}
              editable={!closed}
              initial={{
                firstName: a.firstName,
                lastName: a.lastName,
                email: a.email,
                phone: a.phone ?? "",
                constraints: a.constraints ?? "",
                preferences: a.preferences.map((p) => p.positionId),
              }}
              positions={eventPositions
                .filter((p) => p.status === "active")
                .map((p) => ({ id: p.positionId, name: p.name }))}
            />
          </Panel>
        </div>
        <div className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <Panel>
            <PanelTitle>Décision</PanelTitle>
            <DecisionsPanel ctx={panelCtx} status={a.status} />
          </Panel>
          <Panel className="bg-lavender">
            <InternalNotesForm ctx={panelCtx} notes={a.internalNotes ?? ""} />
          </Panel>
        </div>
      </div>
    </>
  );
}
