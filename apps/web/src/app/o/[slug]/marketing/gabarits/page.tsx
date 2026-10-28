import { listTemplates } from "@kroov/domain/marketing";
import { ForbiddenState, PageHeader } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { TemplatesPanel } from "./templates-panel";

export const metadata: Metadata = { title: "Gabarits" };

export default async function TemplatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/marketing/gabarits`);
  if (!ctx.can("campaigns.manage")) {
    return (
      <>
        <PageHeader eyebrow="Marketing" title="Accès réservé." />
        <ForbiddenState description="Les gabarits sont réservés aux personnes disposant du droit « préparer des campagnes »." />
      </>
    );
  }
  const templates = await listTemplates(db(), ctx.session.actor, ctx.organization.id);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${slug}/marketing`} className="underline underline-offset-4">
            ← Marketing
          </Link>
        }
        title="Gabarits"
        description="Des contenus réutilisables (objet, pré-en-tête, corps en Markdown restreint) pour démarrer une campagne plus vite."
      />
      <TemplatesPanel
        ctx={{ organizationId: ctx.organization.id, slug }}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          subject: t.subject,
          preheader: t.preheader ?? "",
          body: t.body,
        }))}
      />
    </>
  );
}
