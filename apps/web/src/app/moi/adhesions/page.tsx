import { formatDateFr } from "@kroov/domain/kernel";
import { listMyMemberships, MEMBERSHIP_STATUS_LABELS } from "@kroov/domain/memberships";
import { Badge, EmptyState, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { requireSession } from "@/lib/session";
import { ticketingContext } from "@/lib/ticketing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mes adhésions" };

/** Mes adhésions — rattachées au compte ou à l'adresse du compte. */
export default async function MyMembershipsPage() {
  const session = await requireSession("/moi/adhesions");
  const memberships = await listMyMemberships(db(), ticketingContext(), session.actor, session.user.email);
  return (
    <AppPublicShell back={{ href: "/moi", label: "Retour à mon compte" }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">Mon compte</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">Mes adhésions</h1>
        {memberships.length === 0 ? (
          <EmptyState
            className="mt-6"
            title="Aucune adhésion pour l'instant"
            description={`Les adhésions prises avec l'adresse ${session.user.email} apparaîtront ici.`}
          />
        ) : (
          <ul className="m-0 mt-6 list-none space-y-3 p-0">
            {memberships.map((m) => (
              <li key={m.id}>
                <Link href={`/adhesion/${m.id}`} className="block">
                  <Panel className="hover:border-ink">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <b>{m.organizationName}</b>
                        <span className="block text-[12px] text-muted">
                          {m.number} · {m.plan.name}
                          {m.validUntil ? ` · jusqu'au ${formatDateFr(m.validUntil, "Europe/Paris")}` : ""}
                        </span>
                      </div>
                      <Badge
                        tone={
                          m.status === "active"
                            ? "lime"
                            : m.status === "pending" || m.status === "awaiting_payment"
                              ? "orange"
                              : "neutral"
                        }
                      >
                        {MEMBERSHIP_STATUS_LABELS[m.status]}
                      </Badge>
                    </div>
                    <p className="mt-2 text-[13px]">
                      {m.priceMinor === 0 ? "Gratuite" : fmtMinor(m.priceMinor, m.currency)} · Voir ma carte →
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
