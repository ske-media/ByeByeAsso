"use client";

import { Button, Input, Select } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUSES: Array<[string, string]> = [
  ["all", "Tous les statuts"],
  ["to_review", "À examiner"],
  ["approved", "Acceptées"],
  ["waitlisted", "Liste d'attente"],
  ["rejected", "Non retenues"],
  ["withdrawn", "Retirées"],
];

export type VolunteersTab = "candidatures" | "equipes" | "competences";

export function VolunteersFilters({
  slug,
  events,
  skills,
  positions,
  eventId,
  status,
  positionId,
  skillId,
  q,
  tab,
}: {
  slug: string;
  events: Array<{ id: string; title: string }>;
  skills: Array<{ id: string; name: string }>;
  positions: Array<{ id: string; name: string }>;
  eventId: string;
  status: string;
  positionId: string;
  skillId: string;
  q: string;
  tab: VolunteersTab;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const build = (
    next: Partial<{ evenement: string; statut: string; poste: string; competence: string; q: string; onglet: string }>,
  ) => {
    const p = new URLSearchParams();
    const merged = {
      evenement: eventId,
      statut: status,
      poste: positionId,
      competence: skillId,
      q,
      onglet: tab,
      ...next,
    };
    if (merged.evenement) p.set("evenement", merged.evenement);
    if (merged.statut && merged.statut !== "all") p.set("statut", merged.statut);
    if (merged.poste) p.set("poste", merged.poste);
    if (merged.competence) p.set("competence", merged.competence);
    if (merged.q) p.set("q", merged.q);
    if (merged.onglet && merged.onglet !== "candidatures") p.set("onglet", merged.onglet);
    const qs = p.toString();
    return `/o/${slug}/benevoles${qs ? `?${qs}` : ""}`;
  };
  return (
    <div className="my-5 space-y-3">
      <nav aria-label="Onglets" className="flex gap-4 border-b border-border text-[13px] font-bold">
        {(
          [
            ["candidatures", "Candidatures"],
            ["equipes", "Équipes & postes"],
            ["competences", "Compétences"],
          ] as const
        ).map(([t, label]) => (
          <Link
            key={t}
            href={build({ onglet: t })}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px border-b-2 px-1 py-2 ${tab === t ? "border-ink" : "border-transparent text-muted"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "candidatures" ? (
        <form
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_180px_180px_180px_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(build({ q: query }));
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, e-mail ou référence"
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
          <Select value={status} onChange={(e) => router.push(build({ statut: e.target.value }))} aria-label="Statut">
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            value={positionId}
            onChange={(e) => router.push(build({ poste: e.target.value }))}
            aria-label="Poste souhaité"
          >
            <option value="">Tous les postes</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            value={skillId}
            onChange={(e) => router.push(build({ competence: e.target.value }))}
            aria-label="Compétence"
          >
            <option value="">Toutes les compétences</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            Rechercher
          </Button>
        </form>
      ) : null}
    </div>
  );
}
