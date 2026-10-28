import { formatDateFr } from "@kroov/domain/kernel";
import { listMyOrders, ORDER_STATUS_LABELS } from "@kroov/domain/ticketing";
import { Badge, EmptyState, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mes billets" };

/** Mes billets — commandes payées rattachées au compte ou à l'adresse vérifiée. */
export default async function MyTicketsPage() {
  const session = await requireSession("/moi/billets");
  const orders = await listMyOrders(db(), session.actor, session.user.email);
  return (
    <AppPublicShell back={{ href: "/moi", label: "Retour à mon compte" }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">Mon compte</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">Mes billets</h1>
        {orders.length === 0 ? (
          <EmptyState
            className="mt-6"
            title="Aucun billet pour l'instant"
            description={`Les commandes passées avec l'adresse ${session.user.email} apparaîtront ici.`}
          />
        ) : (
          <ul className="m-0 mt-6 list-none space-y-3 p-0">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/commande/${o.id}/confirmation`} className="block">
                  <Panel className="hover:border-ink">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <b>{o.eventTitle}</b>
                        <span className="block text-[12px] text-muted">
                          {o.number} · {o.ticketsSummary} · {formatDateFr(o.createdAt, "Europe/Paris")}
                        </span>
                      </div>
                      <Badge tone={o.status === "paid" ? "lime" : "lavender"}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                    </div>
                    <p className="mt-2 text-[13px]">
                      {o.totalMinor === 0 ? "Gratuit" : fmtMinor(o.totalMinor, o.currency)} · Voir les billets →
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
