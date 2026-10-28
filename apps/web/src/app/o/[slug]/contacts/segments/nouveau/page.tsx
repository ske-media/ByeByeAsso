import { ForbiddenState, PageHeader } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { loadOrgPage } from "@/lib/org-context";
import { editorOptions } from "../_options";
import { SegmentEditor } from "../segment-editor";

export const metadata: Metadata = { title: "Nouveau segment" };

export default async function NewSegmentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/contacts/segments/nouveau`);
  if (!ctx.can("contacts.manage")) {
    return (
      <>
        <PageHeader eyebrow="Contacts · Segments" title="Accès réservé." />
        <ForbiddenState description="Créer un segment demande le droit « gérer les contacts »." />
      </>
    );
  }
  const options = await editorOptions(ctx.session.actor, ctx.organization.id, (p) => ctx.can(p));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${slug}/contacts/segments`} className="underline underline-offset-4">
            ← Segments
          </Link>
        }
        title="Nouveau segment"
        description="L'aperçu se recalcule à chaque modification ; les contacts archivés sont toujours exclus."
      />
      <SegmentEditor ctx={{ organizationId: ctx.organization.id, slug }} options={options} initial={null} canManage />
    </>
  );
}
