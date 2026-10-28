import { formatDateFr } from "@kroov/domain/kernel";
import { listMyApplications, VOLUNTEER_APPLICATION_STATUS_LABELS } from "@kroov/domain/volunteers";
import { Badge, EmptyState, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { ticketingContext } from "@/lib/ticketing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mes candidatures" };

/** Mes candidatures bénévoles — rattachées au compte ou à l'adresse du compte. */
export default async function MyApplicationsPage() {
  const session = await requireSession("/moi/candidatures");
  const applications = await listMyApplications(db(), ticketingContext(), session.actor, session.user.email);
  return (
    <AppPublicShell back={{ href: "/moi", label: "Retour à mon compte" }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">Mon compte</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">Mes candidatures</h1>
        {applications.length === 0 ? (
          <EmptyState
            className="mt-6"
            title="Aucune candidature pour l'instant"
            description={`Les candidatures bénévoles faites avec l'adresse ${session.user.email} apparaîtront ici.`}
          />
        ) : (
          <ul className="m-0 mt-6 list-none space-y-3 p-0">
            {applications.map((a) => (
              <li key={a.id}>
                <Link href={`/candidature/${a.id}`} className="block">
                  <Panel className="hover:border-ink">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <b>{a.event.title}</b>
                        <span className="block text-[12px] text-muted">
                          {a.organizationName} · {a.number} · {formatDateFr(a.event.startsAt, a.event.timezone)}
                        </span>
                      </div>
                      <Badge
                        tone={
                          a.status === "approved"
                            ? "lime"
                            : a.status === "submitted" || a.status === "under_review"
                              ? "orange"
                              : "neutral"
                        }
                      >
                        {VOLUNTEER_APPLICATION_STATUS_LABELS[a.status]}
                      </Badge>
                    </div>
                    <p className="mt-2 text-[13px]">
                      {a.preferences.map((p) => p.positionName).join(", ") || "Sans vœu"} · Voir ma candidature →
                    </p>
                  </Panel>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppPublicShell>
  );
}
