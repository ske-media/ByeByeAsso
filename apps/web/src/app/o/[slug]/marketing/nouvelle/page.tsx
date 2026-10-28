import { ForbiddenState, PageHeader } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { loadOrgPage } from "@/lib/org-context";
import { editorOptions } from "../_options";
import { CampaignEditor } from "../campaign-editor";

export const metadata: Metadata = { title: "Nouvelle campagne" };

export default async function NewCampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/marketing/nouvelle`);
  if (!ctx.can("campaigns.manage")) {
    return (
      <>
        <PageHeader eyebrow="Marketing" title="Accès réservé." />
        <ForbiddenState description="Créer une campagne demande le droit « préparer des campagnes »." />
      </>
    );
  }
  const options = await editorOptions(ctx.session.actor, ctx.organization.id, ctx.can("contacts.read"));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${slug}/marketing`} className="underline underline-offset-4">
            ← Marketing
          </Link>
        }
        title="Nouvelle campagne"
        description="Un brouillon d'abord ; l'envoi passe toujours par la vérification de l'audience."
      />
      <CampaignEditor
        ctx={{ organizationId: ctx.organization.id, slug }}
        options={options}
        initial={null}
        preview={null}
        canSend={ctx.can("campaigns.send")}
      />
    </>
  );
}
