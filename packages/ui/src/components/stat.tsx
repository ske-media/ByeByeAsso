import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../lib/cn";

/**
 * Stat — gros indicateur avec libellé, valeur (chiffres tabulaires) et précision.
 * Ne jamais afficher « 0 » quand la valeur est inconnue : utiliser `loading`.
 */
const statVariants = cva("rounded-[13px] border border-border p-5 min-w-0", {
  variants: {
    tone: {
      surface: "bg-surface",
      lime: "bg-lime",
      pink: "bg-pink",
      orange: "bg-orange",
      lavender: "bg-lavender",
      neutral: "bg-neutral",
    },
  },
  defaultVariants: { tone: "surface" },
});

export interface StatProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof statVariants> {
  label: React.ReactNode;
  value?: React.ReactNode;
  /** Unit or qualifier shown right after the value (e.g. "€", "/ 36"). */
  unit?: React.ReactNode;
  hint?: React.ReactNode;
  loading?: boolean;
}

export function Stat({ label, value, unit, hint, loading = false, tone, className, ...props }: StatProps) {
  return (
    <div className={cn(statVariants({ tone }), className)} {...props}>
      <span className="block text-[12px] font-bold">{label}</span>
      {loading ? (
        <>
          <span className="k-skeleton mt-2 mb-1 block h-10 w-2/3" aria-hidden="true" />
          <span className="k-sr-only">Chargement de la valeur</span>
        </>
      ) : (
        <strong className="k-tabular mt-2 mb-1 block text-stat font-black">
          {value}
          {unit ? <span className="ml-1 text-[0.6em] font-bold tracking-normal">{unit}</span> : null}
        </strong>
      )}
      {hint ? (
        // On tinted cards the muted grey fails WCAG AA (4.5:1 at 11 px): keep ink, slightly softened.
        <small className={cn("block text-[11px] leading-[1.5]", tone ? "text-ink/85" : "text-muted")}>{hint}</small>
      ) : null}
    </div>
  );
}

/** Grid for 3–4 stats on desktop, 2 per row on tablet, 1 on mobile. */
export function StatGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", className)} {...props} />;
}
