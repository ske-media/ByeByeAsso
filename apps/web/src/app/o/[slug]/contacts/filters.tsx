"use client";

import { Button, Input, Select } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MARKETING_LABELS, SOURCE_LABELS } from "./labels";

export type ContactsTab = "contacts" | "etiquettes" | "doublons";

export function ContactsFilters({
  slug,
  tab,
  q,
  marketing,
  source,
  tagId,
  eventId,
  status,
  tags,
  events,
}: {
  slug: string;
  tab: ContactsTab;
  q: string;
  marketing: string;
  source: string;
  tagId: string;
  eventId: string;
  status: string;
  tags: Array<{ id: string; name: string }>;
  events: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const build = (next: Partial<Record<string, string>>) => {
    const merged: Record<string, string> = {
      q,
      consentement: marketing,
      source,
      etiquette: tagId,
      evenement: eventId,
      statut: status,
      onglet: tab,
      ...next,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (!v) continue;
      if (k === "statut" && v === "active") continue;
      if (k === "onglet" && v === "contacts") continue;
      p.set(k, v);
    }
    const qs = p.toString();
    return `/o/${slug}/contacts${qs ? `?${qs}` : ""}`;
  };
  return (
    <div className="my-5 space-y-3">
      <nav aria-label="Onglets" className="flex flex-wrap gap-4 border-b border-border text-[13px] font-bold">
        {(
          [
            ["contacts", "Contacts"],
            ["etiquettes", "Étiquettes"],
            ["doublons", "Doublons"],
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
        <Link
          href={`/o/${slug}/contacts/segments`}
          className="-mb-px border-b-2 border-transparent px-1 py-2 text-muted"
        >
          Segments →
        </Link>
        <Link
          href={`/o/${slug}/contacts/exclusions`}
          className="-mb-px border-b-2 border-transparent px-1 py-2 text-muted"
        >
          Exclusions →
        </Link>
      </nav>
      {tab === "contacts" ? (
        <form
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_170px_170px_180px_130px_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(build({ q: query }));
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, e-mail, téléphone"
            aria-label="Rechercher"
          />
          <Select
            value={marketing}
            onChange={(e) => router.push(build({ consentement: e.target.value }))}
            aria-label="Consentement"
          >
            <option value="">Tout consentement</option>
            {Object.entries(MARKETING_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            value={tagId}
            onChange={(e) => router.push(build({ etiquette: e.target.value }))}
            aria-label="Étiquette"
          >
            <option value="">Toute étiquette</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select value={source} onChange={(e) => router.push(build({ source: e.target.value }))} aria-label="Origine">
            <option value="">Toute origine</option>
            {Object.entries(SOURCE_LABELS)
              .filter(([v]) => v !== "system")
              .map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
          </Select>
          <Select
            value={eventId}
            onChange={(e) => router.push(build({ evenement: e.target.value }))}
            aria-label="A commandé pour"
          >
            <option value="">Tout événement</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => router.push(build({ statut: e.target.value }))} aria-label="État">
            <option value="active">Actifs</option>
            <option value="archived">Archivés</option>
          </Select>
          <Button type="submit" variant="secondary">
            Rechercher
          </Button>
        </form>
      ) : null}
    </div>
  );
}
