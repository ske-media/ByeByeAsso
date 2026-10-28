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
  const pending = canInvite
    ? (await listInvitations(db(), ctx.session.actor, ctx.organization.id)).filter((i) => i.status === "pending").length
    : 0;

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
        team: ctx.can("organization.read"),
        settings: ctx.can("organization.manage"),
      }}
      pendingInvitations={pending}
    >
      {children}
    </OrgShell>
  );
}
