import { getPreferences, listNotifications } from "@kroov/domain/notifications";
import { PageHeader, Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { NotificationList, PreferencesForm } from "./notifications-panel";

export const metadata: Metadata = { title: "Notifications" };

/** Notifications internes du membre connecté (phase 9) + préférences par type. */
export default async function NotificationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/notifications`);
  const [list, preferences] = await Promise.all([
    listNotifications(db(), ctx.session.actor, ctx.organization.id, { limit: 100 }),
    getPreferences(db(), ctx.session.actor, ctx.organization.id),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Opérations"
        title="Vos notifications."
        description="Ce que l'organisation vous signale, selon vos accès : candidatures à examiner, indisponibilités, campagnes terminées, remboursements, adhésions à valider, événements publiés."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Panel>
          <PanelTitle>Fil</PanelTitle>
          <NotificationList
            organizationId={ctx.organization.id}
            slug={slug}
            items={list.items.map((n) => ({
              id: n.id,
              kind: n.kind,
              title: n.title,
              body: n.body,
              href: n.href,
              readAt: n.readAt?.toISOString() ?? null,
              createdAt: n.createdAt.toISOString(),
            }))}
          />
        </Panel>
        <Panel>
          <PanelTitle>Préférences</PanelTitle>
          <p className="text-[13px] text-muted">
            Les notifications sont internes (dans Kroov). Décochez un type pour ne plus le recevoir — les e-mails
            transactionnels existants ne sont pas concernés.
          </p>
          <PreferencesForm organizationId={ctx.organization.id} slug={slug} preferences={preferences} />
        </Panel>
      </div>
    </>
  );
}
