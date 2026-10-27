"use client";

import { OrganizationShell } from "@kroov/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { OrganizationSwitcher } from "./switcher";
import { UserMenu } from "./user-menu";

export interface OrgNavProps {
  slug: string;
  organizationName: string;
  userName: string;
  organizations: Array<{ id: string; name: string; slug: string }>;
  /** Which sections the member may see (computed server-side). */
  sections: { team: boolean; settings: boolean };
  pendingInvitations?: number;
  children: ReactNode;
}

/**
 * Organizer shell for Phase 1. Navigation only lists sections that exist: modules of later
 * phases are added when they ship — no dead links, no fake buttons.
 */
export function OrgShell({
  slug,
  organizationName,
  userName,
  organizations,
  sections,
  pendingInvitations,
  children,
}: OrgNavProps) {
  const pathname = usePathname();
  const base = `/o/${slug}`;
  const nav = [
    { href: base, label: "Vue d'ensemble", icon: "✳", active: pathname === base },
    ...(sections.team
      ? [
          {
            href: `${base}/equipe`,
            label: "Équipe & accès",
            icon: "⚿",
            active: pathname.startsWith(`${base}/equipe`),
            badge: pendingInvitations ? (
              <span className="rounded-full bg-lime px-2 text-[11px] font-bold">
                {pendingInvitations}
                <span className="k-sr-only"> invitation(s) en attente</span>
              </span>
            ) : undefined,
          },
        ]
      : []),
    ...(sections.settings
      ? [
          {
            href: `${base}/parametres`,
            label: "Paramètres",
            icon: "⚙",
            active: pathname.startsWith(`${base}/parametres`),
          },
        ]
      : []),
  ];

  const crumbs = pathname.replace(base, "").split("/").filter(Boolean);
  const sectionLabel =
    crumbs[0] === "equipe" ? "Équipe & accès" : crumbs[0] === "parametres" ? "Paramètres" : "Vue d'ensemble";

  return (
    <OrganizationShell
      LinkComponent={Link}
      nav={nav}
      switcher={<OrganizationSwitcher current={{ name: organizationName, slug }} organizations={organizations} />}
      breadcrumb={
        <span>
          <span className="text-muted">{organizationName}</span> <span aria-hidden="true">/</span> <b>{sectionLabel}</b>
        </span>
      }
      topbarActions={<UserMenu name={userName} />}
      footer={
        <>
          <b>Un coup de main ?</b>
          <small className="mt-3 block text-muted">Centre d'aide · Conditions · Confidentialité</small>
        </>
      }
    >
      {children}
    </OrganizationShell>
  );
}
