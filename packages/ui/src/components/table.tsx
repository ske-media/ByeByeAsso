import type * as React from "react";
import { cn } from "../lib/cn";

/**
 * DataTable primitives — en-têtes sémantiques, défilement horizontal dans un conteneur
 * identifié (jamais toute la page), statuts accompagnés de texte.
 */
export function TableContainer({ className, label, ...props }: React.HTMLAttributes<HTMLElement> & { label: string }) {
  return (
    // A scrollable region must be focusable so keyboard users can scroll it (WCAG 2.1.1).
    <section
      className={cn("relative w-full overflow-x-auto rounded-panel border border-border bg-surface", className)}
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: scroll container needs keyboard focus
      tabIndex={0}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-[12px]", className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-[#f2f2e9]", className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border last:border-b-0", className)} {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-[13px] text-left text-[10px] tracking-[0.3px] text-[#5b6054] uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-[15px] align-middle", className)} {...props} />;
}

/** Person cell: avatar initials + name + secondary line. */
export function Person({
  name,
  secondary,
  tone = "lavender",
}: {
  name: string;
  secondary?: React.ReactNode;
  tone?: "lavender" | "pink" | "lime" | "orange" | "neutral";
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const bg = { lavender: "bg-lavender", pink: "bg-pink", lime: "bg-lime", orange: "bg-orange", neutral: "bg-neutral" }[
    tone
  ];
  return (
    <div className="flex items-center gap-[10px]">
      <span
        aria-hidden="true"
        className={cn("flex size-[35px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold", bg)}
      >
        {initials}
      </span>
      <div className="min-w-0">
        <div className="truncate font-bold">{name}</div>
        {secondary ? <small className="block truncate text-[10px] text-muted">{secondary}</small> : null}
      </div>
    </div>
  );
}
