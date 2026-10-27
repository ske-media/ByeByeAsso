import { listMyOrganizations } from "@kroov/domain/organizations";
import { Badge, Button, EmptyState, Panel, Wordmark } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/labels";
import { requireSession } from "@/lib/session";
import { UserMenu } from "../o/[slug]/user-menu";

export const metadata: Metadata = { title: "Mes organisations" };

/** Context switcher: choose an organization or create one. */
export default async function OrganizationsPage() {
  const session = await requireSession("/organisations");
  const organizations = await listMyOrganizations(db(), session.actor);

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-topbar items-center justify-between px-gutter-mobile md:px-gutter">
        <Link href="/" className="rounded-control">
          <Wordmark />
        </Link>
        <UserMenu name={session.user.name} />
      </header>
      <main className="mx-auto w-full max-w-[880px] px-gutter-mobile py-8 md:px-gutter">
        <p className="text-eyebrow font-extrabold uppercase text-muted">Bonjour {session.user.name}</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">
          Vos organisations
        </h1>
        <p className="mt-3 text-muted">
          Chaque organisation a ses propres événements, équipes et données. Rien n'est partagé entre elles.
        </p>

        {organizations.length === 0 ? (
          <EmptyState
            className="mt-8"
            title="Vous ne faites encore partie d'aucune organisation"
            description="Créez la vôtre en deux minutes, ou attendez une invitation d'une organisation existante : elle arrivera par e-mail."
            action={
              <Button asChild variant="primary">
                <Link href="/organisations/nouvelle">Créer une organisation</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="mt-8 grid list-none gap-4 p-0 sm:grid-cols-2">
              {organizations.map((org) => (
                <li key={org.id}>
                  <Link href={`/o/${org.slug}`} className="block rounded-panel">
                    <Panel className="h-full transition-colors hover:border-ink">
                      <p className="text-eyebrow font-extrabold uppercase text-muted">
                        {org.legalForm === "association" ? "Association" : "Organisation"}
                      </p>
                      <h2 className="mt-2 text-panel-title font-bold">{org.name}</h2>
                      <p className="mt-1 text-meta text-muted">/{org.slug}</p>
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {org.roles.map((r) => (
                          <Badge key={r} tone={r === "owner" ? "lime" : "neutral"}>
                            {roleLabel(r)}
                          </Badge>
                        ))}
                      </div>
                    </Panel>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <Button asChild variant="secondary">
                <Link href="/organisations/nouvelle">+ Créer une autre organisation</Link>
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
