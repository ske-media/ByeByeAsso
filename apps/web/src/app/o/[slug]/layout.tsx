import { unreadCount } from "@kroov/domain/notifications";
import { listInvitations } from "@kroov/domain/organizations";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { OrgShell } from "./org-shell";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}`);
  const canInvite = ctx.can("members.invite");
  const [pending, unread] = await Promise.all([
    canInvite
      ? listInvitations(db(), ctx.session.actor, ctx.organization.id).then(
          (l) => l.filter((i) => i.status === "pending").length,
        )
      : Promise.resolve(0),
    unreadCount(db(), ctx.session.actor, ctx.organization.id),
  ]);

  return (
    <OrgShell
      slug={ctx.organization.slug}
      organizationName={ctx.organization.name}
      userName={ctx.session.user.name}
      organizations={ctx.myOrganizations.map((o) => ({ id: o.id, name: o.name, slug: o.slug }))}
      sections={{
        events: ctx.can("events.read") || ctx.member.eventPermissions.size > 0,
        ticketing:
          ctx.can("orders.read") || [...ctx.member.eventPermissions.values()].some((p) => p.has("orders.read")),
        memberships: ctx.can("memberships.manage"),
        volunteers:
          ctx.can("volunteers.review") ||
          [...ctx.member.eventPermissions.values()].some((p) => p.has("volunteers.review")),
        planning:
          ctx.can("volunteers.review") ||
          [...ctx.member.eventPermissions.values()].some((p) => p.has("volunteers.review")),
        contacts: ctx.can("contacts.read"),
        marketing: ctx.can("campaigns.manage"),
        finances: ctx.can("analytics.read"),
        tasks: ctx.can("organization.read"),
        team: ctx.can("organization.read"),
        settings: ctx.can("organization.manage"),
      }}
      pendingInvitations={pending}
      unreadNotifications={unread}
    >
      {children}
    </OrgShell>
  );
}
