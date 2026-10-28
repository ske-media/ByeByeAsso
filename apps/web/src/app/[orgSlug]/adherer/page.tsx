import { getPublicOrganization } from "@kroov/domain/events";
import { formatDateFr, NotFoundError } from "@kroov/domain/kernel";
import { listPublicMembershipPlans } from "@kroov/domain/memberships";
import { unitFee } from "@kroov/domain/ticketing";
import { EmptyState } from "@kroov/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  try {
    const org = await getPublicOrganization(db(), orgSlug);
    return { title: `Adhérer · ${org.name}`, robots: { index: true, follow: true } };
  } catch {
    return { title: "Organisation introuvable" };
  }
}

/** Écran 35 — On fait collectif : formules publiques et demande d'adhésion. */
export default async function PublicJoinPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  let organization: Awaited<ReturnType<typeof getPublicOrganization>>;
  try {
    organization = await getPublicOrganization(db(), orgSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const [plans, session] = await Promise.all([listPublicMembershipPlans(db(), organization.id), currentSession()]);
  const nameParts = (session?.user.name ?? "").trim().split(/\s+/);
  const defaults = {
    email: session?.user.email ?? "",
    firstName: nameParts[0] ?? "",
    lastName: nameParts.slice(1).join(" "),
  };
  return (
    <AppPublicShell back={{ href: `/${orgSlug}`, label: organization.name }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">{organization.name}</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
          On fait
          <br />
          collectif.
        </h1>
        <p className="mt-2 text-[13px] text-muted">
          Adhérer, c'est soutenir le projet et accéder aux tarifs réservés aux adhérents.
        </p>
        <div className="mt-5">
          {plans.length === 0 ? (
            <EmptyState
              title="Adhésions fermées pour le moment"
              description="L'organisation n'a pas encore ouvert de formule d'adhésion. Revenez bientôt."
            />
          ) : (
            <ApplyForm
              organizationSlug={orgSlug}
              defaults={defaults}
              plans={plans.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                priceMinor: p.priceMinor,
                feeMinor: unitFee(p.priceMinor, ticketingContext().fees),
                currency: p.currency,
                periodLabel:
                  p.periodKind === "fixed"
                    ? `Valable jusqu'au ${p.validUntil ? formatDateFr(p.validUntil, organization.timezone) : "—"}`
                    : `Valable ${p.durationMonths ?? 12} mois à partir de l'activation`,
                requiresReview: p.requiresReview,
                benefits: p.benefits,
                remaining: p.maxMembers === null ? null : Math.max(0, p.maxMembers - p.taken),
              }))}
            />
          )}
        </div>
      </div>
    </AppPublicShell>
  );
}
