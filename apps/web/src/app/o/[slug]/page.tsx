import { listInvitations, listMembers } from "@kroov/domain/organizations";
import { Alert, Button, PageHeader, Panel, PanelTitle, Stat, StatGrid } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/labels";
import { loadOrgPage } from "@/lib/org-context";

export const metadata: Metadata = { title: "Vue d'ensemble" };

const LEGAL_FORM_LABELS: Record<string, string> = {
  association: "Association",
  company: "Entreprise",
  collective: "Collectif",
  public_body: "Établissement public",
  other: "Organisation",
};

/**
 * Vue d'ensemble — Phase 1. Shows only real state: team size, pending invitations,
 * organization facts. Event / ticketing indicators appear with their phases.
 */
export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ bienvenue?: string }>;
}) {
  const { slug } = await params;
  const { bienvenue } = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}`);
  const canRead = ctx.can("organization.read");
  const canInvite = ctx.can("members.invite");
  const members = canRead ? await listMembers(db(), ctx.session.actor, ctx.organization.id) : null;
  const invitations = canInvite ? await listInvitations(db(), ctx.session.actor, ctx.organization.id) : null;
  const pending = invitations?.filter((i) => i.status === "pending").length ?? 0;
  const today = new Date().toLocaleDateString("fr-FR", {
    timeZone: ctx.organization.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <>
      <PageHeader
        eyebrow={`${ctx.organization.name} · ${today}`}
        title={
          <>
            Bonjour {ctx.session.user.name.split(" ")[0]} <span aria-hidden="true">✳</span>
          </>
        }
        description="Des nuits mémorables, une organisation sereine."
        actions={
          canInvite ? (
            <Button asChild variant="primary">
              <Link href={`/o/${slug}/equipe`}>+ Inviter une personne</Link>
            </Button>
          ) : undefined
        }
      />

      {bienvenue ? (
        <Alert tone="success" heading="Bienvenue dans l'équipe" className="mb-6">
          Votre invitation a été acceptée. Vos accès correspondent au rôle qui vous a été attribué.
        </Alert>
      ) : null}

      <StatGrid>
        <Stat
          tone="pink"
          label="Équipe"
          value={members ? String(members.length) : "—"}
          hint={
            members
              ? `${members.length > 1 ? "personnes" : "personne"} avec un accès`
              : "Lecture réservée aux rôles d'organisation"
          }
        />
        <Stat
          tone="lavender"
          label="Invitations en attente"
          value={invitations ? String(pending) : "—"}
          hint={invitations ? "Valables 7 jours" : "Réservé aux personnes habilitées à inviter"}
        />
        <Stat
          label="Forme"
          value={LEGAL_FORM_LABELS[ctx.organization.legalForm] ?? ctx.organization.legalForm}
          hint={`${ctx.organization.country} · ${ctx.organization.timezone}`}
        />
        <Stat
          label="Vos rôles"
          value={String(ctx.member.organizationRoles.length)}
          hint={ctx.member.organizationRoles.map(roleLabel).join(", ") || "Aucun rôle d'organisation"}
        />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Panel>
          <PanelTitle>Démarrage</PanelTitle>
          <ol className="m-0 list-none space-y-3 p-0 text-[13px]">
            <li className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-lime text-[11px] font-bold"
              >
                ✓
              </span>
              <span>
                <b>Organisation créée</b> — {ctx.organization.name}
                <span className="block text-muted">Identifiant : /{ctx.organization.slug}</span>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${members && members.length > 1 ? "bg-lime" : "border border-ink"}`}
              >
                {members && members.length > 1 ? "✓" : "2"}
              </span>
              <span>
                <b>Constituer l'équipe</b>
                <span className="block text-muted">
                  {members && members.length > 1
                    ? `${members.length} personnes ont un accès.`
                    : "Invitez vos collaborateurs avec le rôle qui correspond à leur mission."}
                </span>
                {canInvite ? (
                  <Link
                    href={`/o/${slug}/equipe`}
                    className="mt-1 inline-block text-[12px] font-bold underline underline-offset-4"
                  >
                    Gérer l'équipe →
                  </Link>
                ) : null}
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-bold text-muted"
              >
                3
              </span>
              <span className="text-muted">
                <b className="text-ink">Créer un premier événement</b>
                <span className="block">
                  La création d'événements et la billetterie arrivent avec la prochaine version de Kroov.
                </span>
              </span>
            </li>
          </ol>
        </Panel>
        <Panel className="bg-lavender">
          <PanelTitle>Vos accès</PanelTitle>
          <p className="text-[13px]">
            {ctx.member.organizationRoles.length > 0
              ? `Rôles d'organisation : ${ctx.member.organizationRoles.map(roleLabel).join(", ")}.`
              : "Vous n'avez pas encore de rôle d'organisation. Une personne administratrice peut vous en attribuer un."}
          </p>
          {ctx.member.eventPermissions.size > 0 ? (
            <p className="mt-2 text-[13px]">
              Vous avez aussi des droits limités à {ctx.member.eventPermissions.size} événement(s).
            </p>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
