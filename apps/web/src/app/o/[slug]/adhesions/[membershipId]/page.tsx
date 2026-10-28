import { formatDateFr, formatTimeFr } from "@kroov/domain/kernel";
import { getMembership, MEMBERSHIP_STATUS_LABELS } from "@kroov/domain/memberships";
import { Badge, Button, ForbiddenState, PageHeader, Panel, PanelTitle, Person } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { loadOrgPage } from "@/lib/org-context";
import { ticketingContext } from "@/lib/ticketing";
import { MEMBERSHIP_STATUS_TONE } from "../status-tone";
import { MembershipActionsPanel } from "./actions-panel";

export const metadata: Metadata = { title: "Adhésion" };

const CHANGE_LABELS: Record<string, string> = {
  activated: "Activation",
  extended: "Prolongation",
  suspended: "Suspension",
  reactivated: "Réactivation",
  expired: "Expiration",
  cancelled: "Annulation",
  renewed: "Renouvellement",
};

/** Détail d'une adhésion : demande, validité, paiement, historique append-only, décisions. */
export default async function MembershipDetailPage({
  params,
}: {
  params: Promise<{ slug: string; membershipId: string }>;
}) {
  const { slug, membershipId } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/adhesions/${membershipId}`);
  if (!ctx.can("memberships.manage")) {
    return (
      <>
        <PageHeader eyebrow="Adhésions" title="Adhésion" />
        <ForbiddenState description="La gestion des adhésions est réservée aux administrateurs et aux responsables adhésions." />
      </>
    );
  }
  let m: Awaited<ReturnType<typeof getMembership>>;
  try {
    m = await getMembership(db(), ticketingContext(), ctx.session.actor, ctx.organization.id, membershipId);
  } catch {
    notFound();
  }
  const tz = ctx.organization.timezone;
  const when = (d: Date) => `${formatDateFr(d, tz)}, ${formatTimeFr(d, tz)}`;
  return (
    <>
      <PageHeader
        eyebrow="Adhésions"
        title={`${m.member.firstName} ${m.member.lastName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={MEMBERSHIP_STATUS_TONE[m.status]}>{MEMBERSHIP_STATUS_LABELS[m.status]}</Badge>
            <span>
              {m.number} · {m.plan.name}
            </span>
          </span>
        }
        actions={
          <Button asChild variant="secondary">
            <Link href={`/o/${slug}/adhesions`}>← Adhérents</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelTitle>Adhérent</PanelTitle>
            <Person name={`${m.member.firstName} ${m.member.lastName}`} secondary={m.member.email} tone="lavender" />
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-muted">Demande reçue</dt>
                <dd>{when(m.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted">Compte Kroov</dt>
                <dd>{m.member.userId ? "Rattachée à un compte" : "Sans compte (lien e-mail)"}</dd>
              </div>
              <div>
                <dt className="text-muted">Actualités</dt>
                <dd>{m.marketingOptIn ? "Accepte de recevoir les actualités" : "Pas d'accord actualités"}</dd>
              </div>
              <div>
                <dt className="text-muted">Validité</dt>
                <dd>
                  {m.validFrom && m.validUntil
                    ? `${formatDateFr(m.validFrom, tz)} → ${formatDateFr(m.validUntil, tz)}`
                    : "Non encore active"}
                </dd>
              </div>
              {m.renewedFrom ? (
                <div>
                  <dt className="text-muted">Renouvelle</dt>
                  <dd>
                    <Link href={`/o/${slug}/adhesions/${m.renewedFrom}`} className="underline underline-offset-4">
                      l'adhésion précédente
                    </Link>
                  </dd>
                </div>
              ) : null}
              {m.renewedBy ? (
                <div>
                  <dt className="text-muted">Renouvelée par</dt>
                  <dd>
                    <Link href={`/o/${slug}/adhesions/${m.renewedBy}`} className="underline underline-offset-4">
                      une nouvelle adhésion
                    </Link>
                  </dd>
                </div>
              ) : null}
              {m.cancellationReason ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted">Motif</dt>
                  <dd>{m.cancellationReason}</dd>
                </div>
              ) : null}
            </dl>
          </Panel>
          <Panel>
            <PanelTitle>Cotisation</PanelTitle>
            <p className="text-[13px]">
              {m.priceMinor === 0 ? "Adhésion gratuite." : `${fmtMinor(m.priceMinor, m.currency)} (hors frais)`}
              {m.payment ? (
                <span className="block text-muted">
                  Paiement {m.payment.status}
                  {m.payment.methodLabel ? ` · ${m.payment.methodLabel}` : ""} ·{" "}
                  {fmtMinor(m.payment.amountMinor, m.currency)}
                </span>
              ) : m.priceMinor > 0 ? (
                <span className="block text-muted">Aucun paiement enregistré.</span>
              ) : null}
            </p>
          </Panel>
          <Panel>
            <PanelTitle>Historique</PanelTitle>
            {m.validityChanges.length === 0 ? (
              <p className="text-[13px] text-muted">
                {m.application
                  ? `Demande ${m.application.status === "submitted" ? "en attente d'examen" : m.application.status}${m.application.rejectionReason ? ` — ${m.application.rejectionReason}` : ""}.`
                  : "Aucun changement de validité pour l'instant."}
              </p>
            ) : (
              <ol className="m-0 list-none space-y-2 p-0 text-[13px]">
                {m.validityChanges.map((c) => (
                  <li key={`${c.at.toISOString()}-${c.kind}`} className="border-b border-border pb-2 last:border-0">
                    <b>{CHANGE_LABELS[c.kind] ?? c.kind}</b> · {when(c.at)} ·{" "}
                    {c.actor.startsWith("system:") ? "automatique (Kroov)" : c.actor}
                    {c.newValidUntil ? (
                      <span className="block text-muted">Validité jusqu'au {formatDateFr(c.newValidUntil, tz)}</span>
                    ) : null}
                    {c.reason ? <span className="block text-muted">{c.reason}</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
        <Panel className="lg:sticky lg:top-6 lg:self-start">
          <PanelTitle>Décisions</PanelTitle>
          <MembershipActionsPanel
            organizationId={ctx.organization.id}
            slug={slug}
            membershipId={m.id}
            status={m.status}
            timezone={tz}
            paid={m.priceMinor > 0}
          />
        </Panel>
      </div>
    </>
  );
}
