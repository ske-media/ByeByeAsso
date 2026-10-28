"use client";

import { Button, Input, Select } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUSES: Array<[string, string]> = [
  ["all", "Tous les statuts"],
  ["pending", "À examiner"],
  ["awaiting_payment", "Paiement attendu"],
  ["active", "Actives"],
  ["suspended", "Suspendues"],
  ["expired", "Expirées"],
  ["rejected", "Refusées"],
  ["cancelled", "Annulées"],
];

export type MembershipsTab = "adherents" | "formules" | "renouvellements";

export function MembershipsFilters({
  slug,
  plans,
  planId,
  status,
  q,
  tab,
}: {
  slug: string;
  plans: Array<{ id: string; name: string }>;
  planId: string;
  status: string;
  q: string;
  tab: MembershipsTab;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const build = (next: Partial<{ formule: string; statut: string; q: string; onglet: string }>) => {
    const p = new URLSearchParams();
    const merged = { formule: planId, statut: status, q, onglet: tab, ...next };
    if (merged.formule) p.set("formule", merged.formule);
    if (merged.statut && merged.statut !== "all") p.set("statut", merged.statut);
    if (merged.q) p.set("q", merged.q);
    if (merged.onglet && merged.onglet !== "adherents") p.set("onglet", merged.onglet);
    const qs = p.toString();
    return `/o/${slug}/adhesions${qs ? `?${qs}` : ""}`;
  };
  return (
    <div className="my-5 space-y-3">
      <nav aria-label="Onglets" className="flex gap-4 border-b border-border text-[13px] font-bold">
        {(
          [
            ["adherents", "Adhérents"],
            ["formules", "Formules"],
            ["renouvellements", "Renouvellements"],
          ] as const
        ).map(([t, label]) => (
          <Link
            key={t}
            href={build({ onglet: t, statut: "all" })}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px border-b-2 px-1 py-2 ${tab === t ? "border-ink" : "border-transparent text-muted"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab !== "formules" ? (
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
            placeholder="Nom, e-mail ou n° d'adhésion"
            aria-label="Rechercher"
          />
          <Select value={planId} onChange={(e) => router.push(build({ formule: e.target.value }))} aria-label="Formule">
            <option value="">Toutes les formules</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {tab === "adherents" ? (
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
      ) : null}
    </div>
  );
}
