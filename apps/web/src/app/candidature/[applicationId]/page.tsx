import {
  formatDateFr,
  formatRangeFr,
  formatTimeFr,
  instantToWallClock,
  NotFoundError,
  wallClockDateString,
  wallClockTimeString,
} from "@kroov/domain/kernel";
import { listMissions } from "@kroov/domain/scheduling";
import {
  getApplicationForCandidate,
  getPublicVolunteering,
  VOLUNTEER_APPLICATION_STATUS_LABELS,
} from "@kroov/domain/volunteers";
import { Alert, Badge, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";
import { Missions } from "./missions";
import { TrackingActions } from "./tracking-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ma candidature", robots: { index: false } };

const TONE: Record<string, "lime" | "orange" | "neutral" | "error" | "lavender"> = {
  submitted: "orange",
  under_review: "orange",
  approved: "lime",
  waitlisted: "lavender",
  rejected: "neutral",
  assigned: "lime",
  confirmed: "lime",
  withdrawn: "neutral",
};

/** Écran 39 — Suivi de candidature : statut, vœux, disponibilités, binôme, modification, retrait. */
export default async function TrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ applicationId: string }>;
  searchParams: Promise<{ k?: string; nouveau?: string }>;
}) {
  const { applicationId } = await params;
  const sp = await searchParams;
  const session = await currentSession();
  let a: Awaited<ReturnType<typeof getApplicationForCandidate>>;
  try {
    a = await getApplicationForCandidate(db(), ticketingContext(), applicationId, {
      accessToken: sp.k ?? null,
      actor: session?.actor,
      email: session?.user.emailVerified ? session.user.email : undefined,
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const tz = a.event.timezone;
  const when = (d: Date) => `${formatDateFr(d, tz)}, ${formatTimeFr(d, tz)}`;
  const volunteering = a.editable ? await getPublicVolunteering(db(), a.organizationId, a.event.id) : null;
  const missions = ["assigned", "confirmed"].includes(a.status)
    ? await listMissions(db(), a.id, {
        accessToken: sp.k ?? null,
        actor: session?.actor,
        email: session?.user.emailVerified ? session.user.email : undefined,
      })
    : [];
  const copy: Record<string, string> = {
    submitted: "Votre candidature est bien reçue. L'équipe l'examine et vous écrira dès sa décision.",
    under_review: "L'équipe étudie votre candidature. Vous pouvez encore compléter vos disponibilités.",
    approved:
      "Bienvenue dans l'équipe ! Accepter ne publie pas encore de mission : vos créneaux vous seront envoyés dès que le planning sera validé. Gardez vos disponibilités à jour.",
    waitlisted:
      "Vous êtes en liste d'attente : les postes demandés sont déjà pourvus. Élargir vos vœux ou vos disponibilités augmente vos chances.",
    rejected: "Votre candidature n'a pas été retenue cette fois-ci.",
    assigned: "Le planning est publié : vos missions sont ci-dessous, merci de les confirmer.",
    confirmed: "Missions confirmées. Merci ! Le planning qui fait foi est ci-dessous.",
    withdrawn: "Vous avez retiré votre candidature.",
  };
  const wall = (d: Date) => {
    const w = instantToWallClock(d, tz);
    return { date: wallClockDateString(w), time: wallClockTimeString(w) };
  };
  return (
    <AppPublicShell back={{ href: `/${a.organizationSlug}/${a.event.slug}`, label: a.event.title }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">{a.organizationName}</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
          {a.status === "approved" || a.status === "assigned" || a.status === "confirmed" ? (
            <>
              Vous êtes
              <br />
              dans l'équipe.
            </>
          ) : a.status === "submitted" || a.status === "under_review" ? (
            <>
              Candidature
              <br />
              bien reçue.
            </>
          ) : (
            "Ma candidature"
          )}
        </h1>
        {sp.nouveau ? (
          <Alert tone="success" className="mt-4">
            Un e-mail avec le lien de suivi vous a été envoyé : conservez-le, il est personnel.
          </Alert>
        ) : null}
        <Panel className="mt-5 bg-lavender">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-eyebrow font-extrabold uppercase">Candidature bénévole</p>
              <p className="mt-1 text-[22px] font-black leading-tight">
                {a.firstName} {a.lastName}
              </p>
              <p className="text-[13px] text-muted">
                {a.email} · {a.number}
              </p>
            </div>
            <Badge tone={TONE[a.status] ?? "neutral"}>{VOLUNTEER_APPLICATION_STATUS_LABELS[a.status]}</Badge>
          </div>
          <p className="mt-3 text-[13px]">
            {a.event.title} · {formatRangeFr(a.event.startsAt, a.event.endsAt, tz)}
          </p>
          <p className="mt-2 text-[13px]">{copy[a.status]}</p>
          {a.decisionReason ? <p className="mt-1 text-[12px] text-muted">Motif : {a.decisionReason}</p> : null}
        </Panel>

        <Missions
          applicationId={a.id}
          accessToken={a.accessToken}
          missions={missions.map((m) => ({
            assignmentId: m.assignmentId,
            versionLabel: m.versionLabel,
            positionName: m.positionName,
            teamName: m.teamName,
            label: m.label,
            briefing: m.briefing,
            instructions: m.instructions,
            rangeLabel: formatRangeFr(m.startsAt, m.endsAt, tz),
            confirmationStatus: m.confirmationStatus,
            openRequest: m.openRequest !== null,
          }))}
        />
        <Panel className="mt-4">
          <h2 className="text-panel-title font-bold">Mes vœux</h2>
          <ol className="m-0 mt-1 list-none p-0 text-[13px]">
            {a.preferences.map((p) => (
              <li key={p.positionId}>
                {p.rank}. {p.positionName}
                {!p.active ? <span className="text-muted"> (poste retiré)</span> : null}
              </li>
            ))}
          </ol>
          <h2 className="mt-4 text-panel-title font-bold">Mes disponibilités</h2>
          <ul className="m-0 mt-1 list-none space-y-1 p-0 text-[13px]">
            {a.availabilities.map((r) => (
              <li key={r.id}>
                <Badge tone={r.kind === "available" ? "lime" : "neutral"} noDot>
                  {r.kind === "available" ? "Dispo" : "Indispo"}
                </Badge>{" "}
                {when(r.startsAt)} → {when(r.endsAt)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-muted">{a.effectiveHours} h au total.</p>
          {a.skills.length > 0 ? (
            <>
              <h2 className="mt-4 text-panel-title font-bold">Mes compétences</h2>
              <p className="text-[13px]">
                {a.skills
                  .map(
                    (s) => `${s.name}${s.requiresVerification ? (s.verified ? " (vérifiée)" : " (à vérifier)") : ""}`,
                  )
                  .join(" · ")}
              </p>
            </>
          ) : null}
          {a.buddies.length > 0 ? (
            <>
              <h2 className="mt-4 text-panel-title font-bold">Binôme</h2>
              <ul className="m-0 mt-1 list-none p-0 text-[13px]">
                {a.buddies.map((b) => (
                  <li key={b.email}>
                    {b.email}{" "}
                    <Badge tone={b.reciprocal ? "lime" : "neutral"} noDot>
                      {b.reciprocal ? "Souhait réciproque" : "En attente"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Panel>

        <div className="mt-4">
          <TrackingActions
            applicationId={a.id}
            accessToken={a.accessToken}
            editable={a.editable}
            status={a.status}
            timezone={tz}
            positions={(volunteering?.positions ?? []).map((p) => ({ id: p.id, name: p.name }))}
            initialPrefs={a.preferences.map((p) => p.positionId)}
            initialRanges={a.availabilities.map((r) => {
              const s = wall(r.startsAt);
              const e = wall(r.endsAt);
              return {
                uid: r.id,
                kind: r.kind,
                startsDate: s.date,
                startsTime: s.time,
                endsDate: e.date,
                endsTime: e.time,
              };
            })}
            initialBuddies={a.buddies.map((b) => b.email)}
            initialConstraints={a.constraints ?? ""}
          />
        </div>
        <p className="mt-6 text-[12px] text-muted">
          Les événements de l'organisation sont sur{" "}
          <Link href={`/${a.organizationSlug}`} className="font-bold text-ink underline">
            sa page publique
          </Link>
          .
        </p>
      </div>
    </AppPublicShell>
  );
}
