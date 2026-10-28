import { listAuditLog } from "@kroov/domain/organizations";
import { ForbiddenState, PageHeader, Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Paramètres" };

const ACTION_LABELS: Record<string, string> = {
  "organization.created": "Organisation créée",
  "organization.updated": "Réglages modifiés",
  "invitation.created": "Invitation envoyée",
  "invitation.resent": "Invitation renvoyée",
  "invitation.revoked": "Invitation annulée",
  "invitation.accepted": "Invitation acceptée",
  "member.roles_changed": "Rôles modifiés",
  "member.removed": "Accès retiré",
};

/** Écran 24 (partie réglages) + journal d'audit. L'abonnement arrive avec la phase billing. */
export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/parametres`);
  if (!ctx.can("organization.manage")) {
    return (
      <>
        <PageHeader eyebrow="Paramètres" title="Réglages de l'organisation" />
        <ForbiddenState description="Les réglages sont réservés aux propriétaires et administrateurs." />
      </>
    );
  }
  const audit = await listAuditLog(db(), ctx.session.actor, ctx.organization.id, 20);

  return (
    <>
      <PageHeader
        eyebrow="Paramètres"
        title="Réglages de l'organisation"
        description="Identité, fuseau et coordonnées. Chaque modification est tracée."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Panel>
          <PanelTitle>Identité</PanelTitle>
          <SettingsForm organization={ctx.organization} />
        </Panel>
        <div className="space-y-5">
          <Panel className="bg-lavender">
            <PanelTitle>Abonnement et paiements</PanelTitle>
            <p className="text-[13px]">
              L'abonnement Kroov et le compte de versement arriveront avec la billetterie. Rien n'est facturé
              aujourd'hui.
            </p>
          </Panel>
          <Panel>
            <PanelTitle>Journal d'audit</PanelTitle>
            {audit.length === 0 ? (
              <p className="text-[13px] text-muted">Aucune action enregistrée.</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-border p-0 text-[12px]">
                {audit.map((entry) => (
                  <li key={entry.id} className="py-2">
                    <b>{ACTION_LABELS[entry.action] ?? entry.action}</b>
                    <span className="block text-muted">
                      {entry.createdAt.toLocaleString("fr-FR", {
                        timeZone: ctx.organization.timezone,
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
