import { formatDateFr, NotFoundError } from "@kroov/domain/kernel";
import { getMembershipForMember, MEMBERSHIP_STATUS_LABELS } from "@kroov/domain/memberships";
import { unitFee } from "@kroov/domain/ticketing";
import { Alert, Badge, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { ticketingContext } from "@/lib/ticketing";
import { MemberActions } from "./member-actions";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mon adhésion", robots: { index: false } };

const TONE: Record<string, "lime" | "orange" | "neutral" | "error" | "lavender"> = {
  pending: "orange",
  awaiting_payment: "orange",
  active: "lime",
  suspended: "error",
  rejected: "neutral",
  expired: "neutral",
  cancelled: "neutral",
};

/** Écrans 36 (carte d'adhérent) + 47 (renouvellement) — accès par lien signé ou compte propriétaire. */
export default async function MembershipCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ membershipId: string }>;
  searchParams: Promise<{ k?: string; annule?: string; nouveau?: string }>;
}) {
  const { membershipId } = await params;
  const sp = await searchParams;
  const session = await currentSession();
  let m: Awaited<ReturnType<typeof getMembershipForMember>>;
  try {
    m = await getMembershipForMember(db(), ticketingContext(), membershipId, {
      accessToken: sp.k ?? null,
      actor: session?.actor,
      email: session?.user.emailVerified ? session.user.email : undefined,
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const tz = "Europe/Paris";
  const statusCopy: Record<string, string> = {
    pending: "Votre demande est en cours d'examen par l'organisation. Vous recevrez un e-mail dès sa décision.",
    awaiting_payment: m.plan.requiresReview
      ? "Demande approuvée ! Il ne reste qu'à régler la cotisation pour activer votre adhésion."
      : "Réglez la cotisation pour activer votre adhésion.",
    active: "Présentez cette carte sur simple demande. Les tarifs adhérents sont appliqués avec cet e-mail.",
    suspended: "Adhésion suspendue par l'organisation : les avantages sont désactivés jusqu'à réactivation.",
    rejected: "Demande refusée par l'organisation.",
    expired: "Cette adhésion est arrivée à son terme.",
    cancelled: "Cette adhésion a été annulée.",
  };
  return (
    <AppPublicShell back={{ href: `/${m.organizationSlug}`, label: m.organizationName }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">{m.organizationName}</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
          {m.status === "active" ? (
            <>
              Vous faites partie
              <br />
              du collectif.
            </>
          ) : m.status === "pending" ? (
            <>
              Demande
              <br />
              bien reçue.
            </>
          ) : (
            "Mon adhésion"
          )}
        </h1>
        {sp.nouveau ? (
          <Alert tone="success" className="mt-4">
            {m.status === "active"
              ? "Adhésion activée. Un e-mail avec le lien de cette carte vous a été envoyé."
              : "Un e-mail avec le lien de suivi de votre adhésion vous a été envoyé : conservez-le."}
          </Alert>
        ) : null}
        <Panel className="mt-5 bg-lavender">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-eyebrow font-extrabold uppercase">Carte d'adhérent</p>
              <p className="mt-1 text-[22px] font-black leading-tight">
                {m.member.firstName} {m.member.lastName}
              </p>
              <p className="text-[13px] text-muted">{m.member.email}</p>
            </div>
            <Badge tone={TONE[m.status] ?? "neutral"}>{MEMBERSHIP_STATUS_LABELS[m.status]}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            <div>
              <dt className="text-muted">N° d'adhérent</dt>
              <dd className="font-bold">{m.number}</dd>
            </div>
            <div>
              <dt className="text-muted">Formule</dt>
              <dd className="font-bold">{m.plan.name}</dd>
            </div>
            <div>
              <dt className="text-muted">Validité</dt>
              <dd className="font-bold">
                {m.validFrom && m.validUntil
                  ? `${formatDateFr(m.validFrom, tz)} → ${formatDateFr(m.validUntil, tz)}`
                  : "À l'activation"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Cotisation</dt>
              <dd className="font-bold">
                {m.priceMinor === 0 ? "Gratuite" : fmtMinor(m.priceMinor, m.currency)}
                {m.feesMinor > 0 && m.status !== "active" ? (
                  <span className="block text-[11px] font-normal text-muted">
                    + {fmtMinor(m.feesMinor, m.currency)} de frais de service
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[12px]">{statusCopy[m.status]}</p>
          {m.status === "rejected" && m.application?.rejectionReason ? (
            <p className="mt-1 text-[12px] text-muted">Motif : {m.application.rejectionReason}</p>
          ) : null}
          {m.status === "cancelled" && m.cancellationReason ? (
            <p className="mt-1 text-[12px] text-muted">Motif : {m.cancellationReason}</p>
          ) : null}
        </Panel>
        {m.status === "active" ? (
          <div className="mt-3 print:hidden">
            <PrintButton />
          </div>
        ) : null}
        <div className="mt-4 print:hidden">
          <MemberActions
            membershipId={m.id}
            accessToken={m.accessToken}
            status={m.status}
            totalMinor={m.priceMinor + m.feesMinor}
            currency={m.currency}
            cancelled={Boolean(sp.annule)}
            renewalPlans={m.renewalPlans.map((p) => ({
              id: p.id,
              name: p.name,
              priceMinor: p.priceMinor,
              feeMinor: unitFee(p.priceMinor, ticketingContext().fees),
              currency: p.currency,
              periodLabel:
                p.periodKind === "fixed"
                  ? `jusqu'au ${p.validUntil ? formatDateFr(p.validUntil, tz) : "—"}`
                  : `${p.durationMonths ?? 12} mois`,
              requiresReview: p.requiresReview,
            }))}
          />
        </div>
        {m.renewedBy ? (
          <p className="mt-4 text-[12px] text-muted">
            Cette adhésion a été renouvelée : la nouvelle carte vous a été envoyée par e-mail.
          </p>
        ) : null}
        <p className="mt-6 text-[12px] text-muted">
          Les événements de l'organisation sont sur{" "}
          <Link href={`/${m.organizationSlug}`} className="font-bold text-ink underline">
            sa page publique
          </Link>
          . L'accès à un événement nécessite un billet.
        </p>
      </div>
    </AppPublicShell>
  );
}
