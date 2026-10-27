import { Wordmark } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { UserMenu } from "../../o/[slug]/user-menu";
import { CreateOrganizationForm } from "./form";

export const metadata: Metadata = { title: "Créer une organisation" };

/** Écran 02 — Créer son organisation. */
export default async function NewOrganizationPage() {
  const session = await requireSession("/organisations/nouvelle");
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-topbar items-center justify-between px-gutter-mobile md:px-gutter">
        <Link href="/organisations" className="rounded-control">
          <Wordmark />
        </Link>
        <UserMenu name={session.user.name} />
      </header>
      <main className="mx-auto w-full max-w-[1100px] px-gutter-mobile py-8 md:px-gutter">
        <p className="text-eyebrow font-extrabold uppercase text-muted">Première étape</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">
          Créer votre organisation
        </h1>
        <p className="mt-3 max-w-prose text-muted">
          L'organisation regroupe vos événements, votre équipe, vos adhésions et vos contacts. Vous en serez
          propriétaire.
        </p>
        <CreateOrganizationForm />
      </main>
    </div>
  );
}
