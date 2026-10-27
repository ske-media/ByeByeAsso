import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../lib/cn";

/**
 * StatusBadge — un statut est toujours un libellé texte ; la couleur ne porte jamais seule le sens.
 * Un badge ne ressemble pas à un bouton.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[5px] px-[9px] py-[5px] text-[10px] font-bold leading-[1.3] tracking-[0.1px]",
  {
    variants: {
      tone: {
        neutral: "bg-neutral text-ink",
        lime: "bg-lime text-ink",
        pink: "bg-pink text-ink",
        orange: "bg-orange text-ink",
        lavender: "bg-lavender text-ink",
        error: "bg-error-bg text-error-text",
        outline: "border border-ink bg-transparent text-ink",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Hide the leading dot (e.g. inside dense tables). */
  noDot?: boolean;
}

export function Badge({ className, tone, noDot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {noDot ? null : (
        <span aria-hidden="true" className="text-[11px] leading-none">
          •
        </span>
      )}
      {children}
    </span>
  );
}

/**
 * Canonical status → (label, tone) mapping for business states. Keep labels in French and
 * explicit; add entries as state machines land in later phases.
 */
export const STATUS_BADGES = {
  draft: { label: "Brouillon", tone: "neutral" },
  published: { label: "Publié", tone: "lime" },
  suspended: { label: "Suspendu", tone: "orange" },
  completed: { label: "Terminé", tone: "neutral" },
  cancelled: { label: "Annulé", tone: "error" },
  archived: { label: "Archivé", tone: "neutral" },
  pending: { label: "En attente", tone: "orange" },
  paid: { label: "Payé", tone: "lime" },
  expired: { label: "Expiré", tone: "neutral" },
  refunded: { label: "Remboursé", tone: "lavender" },
  active: { label: "Actif", tone: "lime" },
  to_review: { label: "À examiner", tone: "orange" },
} as const satisfies Record<string, { label: string; tone: NonNullable<BadgeProps["tone"]> }>;

export type KnownStatus = keyof typeof STATUS_BADGES;

export function StatusBadge({ status, className }: { status: KnownStatus; className?: string }) {
  const { label, tone } = STATUS_BADGES[status];
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}

export { badgeVariants };
