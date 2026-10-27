"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

/** Permanent organization selector (never mixes two organizations in one view). */
export function OrganizationSwitcher({
  current,
  organizations,
}: {
  current: { name: string; slug: string };
  organizations: Array<{ id: string; name: string; slug: string }>;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const others = organizations.filter((o) => o.slug !== current.slug);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-[9px] border border-[#d3d3c8] bg-canvas px-[9px] py-3 text-left text-[12px]"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0">
          <b className="block truncate">{current.name}</b>
          <small className="text-[10px] text-muted">ESPACE ORGANISATEUR</small>
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
      </button>
      {open ? (
        <ul
          id={listId}
          className="absolute inset-x-0 z-10 mt-1 m-0 list-none rounded-[9px] border border-ink bg-surface p-1 text-[12px] shadow-sticker"
        >
          {others.map((o) => (
            <li key={o.id}>
              <Link
                href={`/o/${o.slug}`}
                className="block rounded-control px-3 py-2 hover:bg-ink/5"
                onClick={() => setOpen(false)}
              >
                {o.name}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/organisations"
              className="block rounded-control px-3 py-2 font-bold hover:bg-ink/5"
              onClick={() => setOpen(false)}
            >
              Toutes mes organisations →
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
