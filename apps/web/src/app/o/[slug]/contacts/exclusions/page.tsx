import { listSuppressions } from "@kroov/domain/crm";
import { formatDateFr } from "@kroov/domain/kernel";
import { ForbiddenState, PageHeader, Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { SuppressionsPanel } from "./suppressions-panel";

export const metadata: Metadata = { title: "Exclusions" };

/** Liste d'exclusion (désinscriptions, rebonds, plaintes, demandes) — consultable sans réinscrire personne. */
export default async function ExclusionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ historique?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/contacts/exclusions`);
  if (!ctx.can("contacts.read")) {
    return (
      <>
        <PageHeader eyebrow="Contacts · Exclusions" title="Accès réservé." />
        <ForbiddenState description="La liste d'exclusion est réservée aux personnes disposant du droit « consulter les contacts »." />
      </>
    );
  }
  const all = sp.historique === "1";
  const rows = await listSuppressions(db(), ctx.session.actor, ctx.organization.id, all ? "all" : "active");
  const tz = ctx.organization.timezone;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${slug}/contacts`} className="underline underline-offset-4">
            ← Contacts
          </Link>
        }
        title="Exclusions"
        description="Une adresse exclue ne reçoit aucune campagne, quel que soit son consentement. Rien ne la réinscrit automatiquement : la levée est une décision motivée et tracée."
      />
      <Panel>
        <PanelTitle>
          {all ? "Historique complet" : "Exclusions actives"}{" "}
          <Link
            href={`/o/${slug}/contacts/exclusions${all ? "" : "?historique=1"}`}
            className="ml-2 text-[12px] font-normal underline underline-offset-4"
          >
            {all ? "Voir les actives seulement" : "Voir l'historique (levées comprises)"}
          </Link>
        </PanelTitle>
        <SuppressionsPanel
          ctx={{ organizationId: ctx.organization.id, slug }}
          canManage={ctx.can("contacts.manage")}
          rows={rows.map((r) => ({
            id: r.id,
            email: r.email,
            reason: r.reason,
            source: r.source,
            note: r.note,
            createdBy: r.createdBy,
            created: formatDateFr(r.createdAt, tz),
            lifted: r.liftedAt ? formatDateFr(r.liftedAt, tz) : null,
            liftReason: r.liftReason,
          }))}
        />
      </Panel>
    </>
  );
}
