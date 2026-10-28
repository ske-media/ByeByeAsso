import { isDomainError } from "@kroov/domain/kernel";
import { checkAudience, getCampaign } from "@kroov/domain/marketing";
import { ForbiddenState, PageHeader } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { marketingContext } from "@/lib/marketing";
import { loadOrgPage } from "@/lib/org-context";
import { VerificationPanel } from "./verification-panel";

export const metadata: Metadata = { title: "Vérification de la campagne" };

/** Écran 21 — vérification : recomptage de l'audience, décision légale, envoi ou programmation. */
export default async function VerificationPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
  const { slug, campaignId } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/marketing/${campaignId}/verification`);
  if (!ctx.can("campaigns.send")) {
    return (
      <>
        <PageHeader eyebrow="Marketing" title="Accès réservé." />
        <ForbiddenState description="Programmer ou envoyer une campagne demande le droit « envoyer des campagnes »." />
      </>
    );
  }
  const org = ctx.organization;
  const actor = ctx.session.actor;
  let c: Awaited<ReturnType<typeof getCampaign>>;
  try {
    c = await getCampaign(db(), marketingContext(), actor, org.id, campaignId);
  } catch (error) {
    if (isDomainError(error) && error.code === "not_found") notFound();
    throw error;
  }
  if (c.status !== "draft") redirect(`/o/${slug}/marketing/${campaignId}`);
  const missing: string[] = [];
  if (!c.subject.trim()) missing.push("l'objet");
  if (!c.body.trim()) missing.push("le corps");
  if (!c.fromName.trim()) missing.push("le nom d'expéditeur");
  if (!c.segmentId) missing.push("l'audience (segment)");
  const check = c.segmentId ? await checkAudience(db(), actor, org.id, c.id) : null;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${slug}/marketing/${c.id}`} className="underline underline-offset-4">
            ← {c.name}
          </Link>
        }
        title="Vérifier avant d'envoyer"
        description="L'audience est recomptée maintenant et sera revérifiée au moment de l'envoi : une personne désinscrite entre-temps ne recevra rien."
      />
      <VerificationPanel
        ctx={{ organizationId: org.id, slug }}
        campaign={{
          id: c.id,
          version: c.version,
          name: c.name,
          subject: c.subject,
          fromName: c.fromName,
          segmentName: c.segmentName,
          timezone: org.timezone,
        }}
        missing={missing}
        initialCheck={check}
        preview={c.preview}
      />
    </>
  );
}
