"use client";

import { OrganizationShell } from "@kroov/ui";
import Link from "next/link";
import type { ReactNode } from "react";

const nav = [
  { href: "/design-system", label: "Vue d'ensemble", active: true, icon: "✳" },
  { href: "/design-system#evenements", label: "Événements", icon: "▣" },
  { href: "/design-system#billetterie", label: "Billetterie", icon: "▭" },
  { href: "/design-system#benevoles", label: "Bénévoles", icon: "☺" },
  { href: "/design-system#planning", label: "Planning", icon: "▤" },
  { href: "/design-system#adhesions", label: "Adhésions", icon: "♡" },
  { href: "/design-system#marketing", label: "Marketing", icon: "↗" },
  { href: "/design-system#finances", label: "Finances", icon: "€" },
  { href: "/design-system#equipe", label: "Équipe & accès", icon: "⚿" },
  { href: "/design-system#parametres", label: "Paramètres", icon: "⚙" },
];

/** Client wrapper so the shell (which uses state for the mobile drawer) can host a server page. */
export function DesignSystemShell({ children }: { children: ReactNode }) {
  return (
    <OrganizationShell
      LinkComponent={Link}
      nav={nav}
      switcher={
        <div className="rounded-[9px] border border-[#d3d3c8] bg-canvas px-[9px] py-3 text-[12px]">
          <b className="block">Organisation de démonstration</b>
          <small className="text-[10px] text-muted">ESPACE ORGANISATEUR</small>
        </div>
      }
      breadcrumb={
        <span>
          <span className="text-muted">Organisation</span> <span aria-hidden="true">/</span> <b>Système de design</b>
        </span>
      }
      topbarActions={<span className="text-muted">Développement</span>}
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
