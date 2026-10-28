import type * as React from "react";
import { cn } from "../lib/cn";

/**
 * EventPoster — affiche typographique du kit (aplat rose, anneau orange, astérisque).
 * Sert d'identité visuelle tant que le téléversement d'affiche n'existe pas (phase 9).
 * Aucun décor ne masque le titre, la date ou le lieu.
 */
export interface EventPosterProps extends React.HTMLAttributes<HTMLDivElement> {
  organizationName: string;
  title: string;
  /** e.g. "12 juin 2027" */
  dateLabel: string;
  /** e.g. "Lyon · Le Sucre" */
  placeLabel?: string | undefined;
  tone?: "pink" | "lavender" | "orange";
  compact?: boolean;
}

export function EventPoster({
  organizationName,
  title,
  dateLabel,
  placeLabel,
  tone = "pink",
  compact = false,
  className,
  ...props
}: EventPosterProps) {
  const bg = { pink: "bg-pink", lavender: "bg-lavender", orange: "bg-orange" }[tone];
  const ring = { pink: "border-orange", lavender: "border-pink", orange: "border-lavender" }[tone];
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between overflow-hidden rounded-[10px] text-ink",
        compact ? "min-h-[150px] p-4" : "min-h-[250px] p-6",
        bg,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute -top-10 -right-8 rounded-full border-[38px]",
          ring,
          compact ? "size-28 border-[22px]" : "size-48",
        )}
      />
      <span className="relative z-[1] text-[9px] font-extrabold tracking-[1.5px] uppercase">
        {organizationName} présente
      </span>
      <span
        className={cn(
          "relative z-[1] font-black uppercase leading-[0.94] tracking-[-0.06em]",
          compact ? "my-2 text-[22px]" : "my-4 text-[clamp(28px,6cqw,48px)]",
        )}
      >
        {title}
        <span
          aria-hidden="true"
          className={cn("ml-2 inline-block -rotate-12 text-lime", compact ? "text-[26px]" : "text-[56px]")}
          style={{ textShadow: "3px 3px 0 var(--color-ink)" }}
        >
          ✳
        </span>
      </span>
      <span className="relative z-[1] flex justify-between gap-3 border-t border-ink pt-[10px] text-[9px] font-bold tracking-[1px] uppercase">
        <b>{dateLabel}</b>
        {placeLabel ? <b className="truncate">{placeLabel}</b> : null}
      </span>
    </div>
  );
}
