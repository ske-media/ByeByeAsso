"use client";

import { Button, Input, Select } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUSES: Array<[string, string]> = [
  ["all", "Tous les statuts"],
  ["paid", "Payées"],
  ["awaiting_payment", "En attente de paiement"],
  ["failed", "Refusées"],
  ["partially_refunded", "Remb. partiel"],
  ["refunded", "Remboursées"],
  ["expired", "Expirées"],
];

export function OrdersFilters({
  slug,
  events,
  eventId,
  status,
  q,
  tab,
}: {
  slug: string;
  events: Array<{ id: string; title: string }>;
  eventId: string;
  status: string;
  q: string;
  tab: "commandes" | "participants";
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const build = (next: Partial<{ evenement: string; statut: string; q: string; onglet: string }>) => {
    const p = new URLSearchParams();
    const merged = { evenement: eventId, statut: status, q, onglet: tab, ...next };
    if (merged.evenement) p.set("evenement", merged.evenement);
    if (merged.statut && merged.statut !== "all") p.set("statut", merged.statut);
    if (merged.q) p.set("q", merged.q);
    if (merged.onglet && merged.onglet !== "commandes") p.set("onglet", merged.onglet);
    const qs = p.toString();
    return `/o/${slug}/billetterie${qs ? `?${qs}` : ""}`;
  };
  return (
    <div className="my-5 space-y-3">
      <nav aria-label="Onglets" className="flex gap-4 border-b border-border text-[13px] font-bold">
        {(["commandes", "participants"] as const).map((t) => (
          <Link
            key={t}
            href={build({ onglet: t })}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px border-b-2 px-1 py-2 ${tab === t ? "border-ink" : "border-transparent text-muted"}`}
          >
            {t === "commandes" ? "Commandes" : "Participants"}
          </Link>
        ))}
      </nav>
      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px_220px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(build({ q: query }));
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom, e-mail ou n° de commande"
          aria-label="Rechercher"
        />
        <Select
          value={eventId}
          onChange={(e) => router.push(build({ evenement: e.target.value }))}
          aria-label="Événement"
        >
          <option value="">Tous les événements</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.title}
            </option>
          ))}
        </Select>
        {tab === "commandes" ? (
          <Select value={status} onChange={(e) => router.push(build({ statut: e.target.value }))} aria-label="Statut">
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        ) : (
          <span />
        )}
        <Button type="submit" variant="secondary">
          Rechercher
        </Button>
      </form>
    </div>
  );
}
