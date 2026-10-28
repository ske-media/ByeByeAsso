import { getSegment } from "@kroov/domain/crm";
import { isDomainError } from "@kroov/domain/kernel";
import { ForbiddenState, PageHeader } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { editorOptions } from "../_options";
import { SegmentEditor } from "../segment-editor";

export const metadata: Metadata = { title: "Segment" };

export default async function SegmentPage({ params }: { params: Promise<{ slug: string; segmentId: string }> }) {
  const { slug, segmentId } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/contacts/segments/${segmentId}`);
  if (!ctx.can("contacts.read")) {
    return (
      <>
        <PageHeader eyebrow="Contacts · Segments" title="Accès réservé." />
        <ForbiddenState description="Les segments sont réservés aux personnes disposant du droit « consulter les contacts »." />
      </>
    );
  }
  let segment: Awaited<ReturnType<typeof getSegment>>;
  try {
    segment = await getSegment(db(), ctx.session.actor, ctx.organization.id, segmentId);
  } catch (error) {
    if (isDomainError(error) && error.code === "not_found") notFound();
    throw error;
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
        title={segment.name}
        description={
          segment.kind === "dynamic"
            ? "Segment dynamique : recalculé à chaque affichage et à l'envoi."
            : "Segment statique : liste tenue à la main."
        }
      />
      <SegmentEditor
        ctx={{ organizationId: ctx.organization.id, slug }}
        options={options}
        canManage={ctx.can("contacts.manage")}
        initial={{
          id: segment.id,
          version: segment.version,
          name: segment.name,
          description: segment.description ?? "",
          kind: segment.kind,
          definition: {
            match: segment.definition.match,
            rules: segment.definition.rules.map((r) =>
              r.type === "activity"
                ? {
                    type: "activity" as const,
                    ...(r.after ? { after: r.after.toISOString().slice(0, 10) } : {}),
                    ...(r.before ? { before: r.before.toISOString().slice(0, 10) } : {}),
                  }
                : r,
            ),
          },
          memberCount: segment.evaluation.count,
          members: segment.evaluation.sample,
        }}
      />
    </>
  );
}
