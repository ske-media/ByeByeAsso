import type * as React from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

/**
 * System states. Every route covers at least: loading, empty, error, success, forbidden.
 * These components make each state explicit and accessible (live regions, headings).
 */

export interface EmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-panel border border-dashed border-border-strong bg-surface p-6 md:p-8",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-[10px] bg-lavender text-ink"
        >
          {icon}
        </div>
      ) : null}
      <h2 className="text-panel-title font-bold">{title}</h2>
      {description ? <p className="max-w-prose text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: React.ReactNode;
  /** What happened, what is kept, how to continue. */
  description: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = "Impossible de charger ces données",
  description,
  onRetry,
  retryLabel = "Réessayer",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("rounded-panel border border-error-text/30 bg-error-bg p-6 text-error-text", className)}
    >
      <h2 className="text-panel-title font-bold">{title}</h2>
      <p className="mt-2 max-w-prose">{description}</p>
      {onRetry ? (
        <div className="mt-4">
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface ForbiddenStateProps {
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function ForbiddenState({
  description = "Cette page est réservée à un autre rôle. Demandez l'accès à une personne administratrice de l'organisation.",
  action,
  className,
}: ForbiddenStateProps) {
  return (
    <div className={cn("rounded-panel border border-border bg-surface p-6 md:p-8", className)}>
      <p className="text-eyebrow font-extrabold uppercase text-muted">Accès restreint</p>
      <h2 className="mt-2 text-section-title font-black">Vous n'avez pas accès à cet espace</h2>
      <p className="mt-2 max-w-prose text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export interface LoadingStateProps {
  /** Short description for assistive technologies, e.g. "Chargement des événements". */
  label: string;
  /** Number of skeleton rows. */
  rows?: number;
  className?: string;
}

/** Dimensional skeleton for lists; never shows a fake "0". */
export function LoadingState({ label, rows = 4, className }: LoadingStateProps) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-live="polite">
      <span className="k-sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable placeholder rows
          key={i}
          className="flex items-center gap-4 rounded-panel border border-border bg-surface p-4"
          aria-hidden="true"
        >
          <span className="k-skeleton size-9 shrink-0 rounded-full" />
          <span className="k-skeleton h-4 flex-1" />
          <span className="k-skeleton h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

export type AlertTone = "info" | "success" | "warning" | "error";

const alertTones: Record<AlertTone, string> = {
  info: "bg-lavender text-ink",
  success: "bg-lime text-ink",
  warning: "bg-orange text-ink",
  error: "bg-error-bg text-error-text",
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  heading?: React.ReactNode;
}

/** Inline alert. Error alerts persist; success toasts are a separate, non-essential layer. */
export function Alert({ tone = "info", heading, className, children, ...props }: AlertProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-[9px] px-[18px] py-4 text-[12px] leading-[1.6]", alertTones[tone], className)}
      {...props}
    >
      {heading ? <strong className="block text-[13px]">{heading}</strong> : null}
      {children}
    </div>
  );
}
