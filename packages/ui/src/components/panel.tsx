import type * as React from "react";
import { cn } from "../lib/cn";

/** Panel — surface crème claire, bordure 1 px, coins 14 px, padding 24 px (18–20 px mobile). */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-panel border border-border bg-surface p-[18px] md:p-6",
        "min-w-0 overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

export function PanelTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("mb-4 text-panel-title font-bold", className)} {...props} />;
}

export function PanelFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex flex-wrap items-center gap-2", className)} {...props} />;
}

/** Eyebrow — petit libellé en capitales espacées au-dessus d'un titre. */
export function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-eyebrow font-extrabold uppercase", className)} {...props} />;
}

export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** PageHeader — un seul h1 par page, action principale unique à droite. */
export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="mt-2 mb-3 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">
          {title}
        </h1>
        {description ? <p className="text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
