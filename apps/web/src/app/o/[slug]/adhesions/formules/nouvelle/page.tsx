import { ForbiddenState, PageHeader } from "@kroov/ui";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { getOrganizationCurrency } from "../currency";
import { PlanForm } from "../plan-form";
import { emptyPlanForm } from "../plan-form-data";

export const metadata: Metadata = { title: "Nouvelle formule" };

/** Écran 18 — nouvelle formule d'adhésion. */
export default async function NewPlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/adhesions/formules/nouvelle`);
  if (!ctx.can("memberships.manage")) {
    return (
      <>
        <PageHeader eyebrow="Adhésions" title="Nouvelle formule" />
        <ForbiddenState description="La gestion des formules est réservée aux administrateurs et aux responsables adhésions." />
      </>
    );
  }
  const currency = await getOrganizationCurrency(db(), ctx.organization.id);
  return (
    <>
      <PageHeader
        eyebrow="Adhésions · Formule"
        title="Une formule claire, une adhésion simple."
        description="Montant, période de validité, revue éventuelle des demandes : tout est visible sur la page publique dès l'enregistrement."
      />
      <PlanForm
        organizationId={ctx.organization.id}
        slug={slug}
        organizationName={ctx.organization.name}
        timezone={ctx.organization.timezone}
        currency={currency}
        planId={null}
        initial={emptyPlanForm()}
      />
    </>
  );
}
