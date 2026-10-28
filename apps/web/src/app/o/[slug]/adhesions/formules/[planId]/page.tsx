import { getMembershipPlan } from "@kroov/domain/memberships";
import { Alert, Badge, Button, ForbiddenState, PageHeader } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { PlanForm } from "../plan-form";
import { planToForm } from "../plan-form-data";
import { ArchivePlanButton } from "./archive-button";

export const metadata: Metadata = { title: "Formule" };

/** Écran 18 — modification d'une formule. */
export default async function EditPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; planId: string }>;
  searchParams: Promise<{ cree?: string }>;
}) {
  const { slug, planId } = await params;
  const sp = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/adhesions/formules/${planId}`);
  if (!ctx.can("memberships.manage")) {
    return (
      <>
        <PageHeader eyebrow="Adhésions" title="Formule" />
        <ForbiddenState description="La gestion des formules est réservée aux administrateurs et aux responsables adhésions." />
      </>
    );
  }
  let plan: Awaited<ReturnType<typeof getMembershipPlan>>;
  try {
    plan = await getMembershipPlan(db(), ctx.session.actor, ctx.organization.id, planId);
  } catch {
    notFound();
  }
  return (
    <>
      <PageHeader
        eyebrow="Adhésions · Formule"
        title={plan.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={plan.status === "active" ? "lime" : "neutral"}>
              {plan.status === "active" ? "Active" : "Archivée"}
            </Badge>
            <span>
              {plan.activeMembers} adhérent(s) actif(s)
              {plan.maxMembers ? ` sur ${plan.maxMembers}` : ""} ·{" "}
              <Link href={`/${slug}/adherer`} className="underline underline-offset-4">
                voir la page publique
              </Link>
            </span>
          </span>
        }
        actions={
          <Button asChild variant="secondary">
            <Link href={`/o/${slug}/adhesions?onglet=formules`}>← Formules</Link>
          </Button>
        }
      />
      {sp.cree ? <Alert tone="success">Formule créée. Elle est visible sur votre page publique.</Alert> : null}
      {plan.status === "archived" ? (
        <Alert tone="warning">Formule archivée : elle n'est plus modifiable ni visible publiquement.</Alert>
      ) : (
        <>
          <PlanForm
            organizationId={ctx.organization.id}
            slug={slug}
            organizationName={ctx.organization.name}
            timezone={ctx.organization.timezone}
            currency={plan.currency}
            planId={plan.id}
            initial={planToForm(plan, ctx.organization.timezone)}
          />
          <div className="mt-6">
            <ArchivePlanButton
              organizationId={ctx.organization.id}
              slug={slug}
              planId={plan.id}
              activeMembers={plan.activeMembers}
            />
          </div>
        </>
      )}
    </>
  );
}
