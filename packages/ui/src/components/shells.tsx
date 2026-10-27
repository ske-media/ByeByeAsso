"use client";

import { Menu, X } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
import { Wordmark } from "./wordmark";

/**
 * Three application shells:
 * - OrganizationShell : organisateur (navigation gauche 214 px, bandeau 76 px, contenu 32 px).
 * - PublicShell       : public / adhérent / bénévole (390 px de référence, nav basse).
 * - CheckInShell      : contrôle d'accès (mode professionnel séparé).
 *
 * Shells own the landmark regions (header / nav / main) and responsive behaviour.
 * They never fetch data: everything is passed in by the route.
 */

/** Minimal link contract so shells stay framework-agnostic (Next.js <Link> satisfies it). */
export interface ShellLinkProps {
  href: string;
  className?: string;
  children?: React.ReactNode;
  "aria-current"?: "page" | undefined;
  "aria-label"?: string;
  onClick?: () => void;
}
export type ShellLink = React.ComponentType<ShellLinkProps>;

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  badge?: React.ReactNode;
}

export interface OrganizationShellProps {
  /** Rendered link component so the shell stays framework-agnostic (Next <Link>). */
  LinkComponent: ShellLink;
  nav: NavItem[];
  /** Organization switcher slot (OrganizationSwitcher component in Phase 1). */
  switcher: React.ReactNode;
  /** Breadcrumb or page context shown in the top bar. */
  breadcrumb?: React.ReactNode;
  /** Right side of the top bar: search, notifications, avatar. */
  topbarActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function OrganizationShell({
  LinkComponent,
  nav,
  switcher,
  breadcrumb,
  topbarActions,
  footer,
  children,
}: OrganizationShellProps) {
  const [open, setOpen] = React.useState(false);
  const navId = React.useId();

  return (
    <div className="min-h-dvh bg-canvas">
      {/* Sidebar */}
      <aside
        id={navId}
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-sidebar border-r border-border bg-sidebar px-[17px] py-[30px]",
          "flex flex-col transition-transform duration-ui ease-ui",
          "lg:translate-x-0",
          // Closed drawer: off-canvas AND invisible below lg, so it leaves the a11y tree and tab order.
          open ? "translate-x-0" : "-translate-x-full max-lg:invisible",
        )}
        aria-label="Navigation de l'organisation"
      >
        <div className="flex items-center justify-between px-[10px]">
          <Wordmark />
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-control lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Fermer la navigation"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-8 mb-7">{switcher}</div>
        <nav>
          <ul className="m-0 list-none p-0">
            {nav.map((item) => (
              <li key={item.href}>
                <LinkComponent
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "my-[3px] flex min-h-touch items-center gap-[11px] rounded-control px-[11px] py-3 text-[12px] whitespace-nowrap",
                    item.active ? "bg-lime font-bold text-ink" : "text-[#51554b] hover:bg-ink/5",
                  )}
                >
                  {item.icon ? (
                    <span
                      aria-hidden="true"
                      className="flex size-[17px] items-center justify-center rounded-[4px] border-[1.5px] border-current"
                    >
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="flex-1">{item.label}</span>
                  {item.badge}
                </LinkComponent>
              </li>
            ))}
          </ul>
        </nav>
        {footer ? <div className="mt-auto px-3 pt-8 text-[12px]">{footer}</div> : null}
      </aside>

      {/* Backdrop on mobile */}
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
          aria-label="Fermer la navigation"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {/* Top bar + content, offset by the sidebar width on large screens (no horizontal overflow). */}
      <div className="lg:pl-sidebar">
        <header className="flex h-topbar items-center justify-between gap-4 border-b border-border px-5 text-[12px] lg:px-gutter">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="flex size-11 items-center justify-center rounded-control lg:hidden"
              onClick={() => setOpen(true)}
              aria-controls={navId}
              aria-expanded={open}
              aria-label="Ouvrir la navigation"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <div className="min-w-0 truncate">{breadcrumb}</div>
          </div>
          <div className="flex items-center gap-5">{topbarActions}</div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] px-5 py-6 lg:px-gutter lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export interface PublicShellProps {
  LinkComponent: ShellLink;
  /** Bottom navigation (Découvrir, Mes billets, Collectif, Mon compte). Omit inside purchase funnels. */
  nav?: NavItem[];
  back?: { href: string; label: string };
  /** Right side of the header. */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

export function PublicShell({ LinkComponent, nav, back, headerActions, children }: PublicShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-16 items-center justify-between px-gutter-mobile md:px-gutter">
        <div className="flex min-w-0 items-center gap-2">
          {back ? (
            <LinkComponent
              href={back.href}
              className="flex size-11 items-center justify-center rounded-control"
              aria-label={back.label}
            >
              <span aria-hidden="true">←</span>
            </LinkComponent>
          ) : null}
        </div>
        <LinkComponent href="/" className="absolute left-1/2 -translate-x-1/2 rounded-control">
          <Wordmark size={26} />
        </LinkComponent>
        <div className="flex items-center gap-2">{headerActions}</div>
      </header>
      <main
        className={cn("mx-auto w-full max-w-[640px] flex-1 px-gutter-mobile md:px-gutter", nav ? "pb-24" : "pb-10")}
      >
        {children}
      </main>
      {nav ? (
        <nav
          aria-label="Navigation principale"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
        >
          <ul className="mx-auto grid max-w-[640px] grid-cols-4">
            {nav.map((item) => (
              <li key={item.href}>
                <LinkComponent
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className="flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-bold"
                >
                  <span
                    aria-hidden="true"
                    className={cn("flex size-7 items-center justify-center rounded-full", item.active && "bg-lime")}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </LinkComponent>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

export interface CheckInShellProps {
  LinkComponent: ShellLink;
  /** Event + controller identity are always visible in this mode. */
  context: React.ReactNode;
  nav: NavItem[];
  children: React.ReactNode;
}

export function CheckInShell({ LinkComponent, context, nav, children }: CheckInShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex items-center justify-between gap-3 border-b border-border px-gutter-mobile py-3">
        <Wordmark size={24} />
        <div className="min-w-0 truncate text-[12px] font-bold">{context}</div>
      </header>
      <main className="mx-auto w-full max-w-[640px] flex-1 px-gutter-mobile pb-24 md:px-gutter">{children}</main>
      <nav
        aria-label="Navigation contrôle d'accès"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto grid max-w-[640px] grid-cols-3">
          {nav.map((item) => (
            <li key={item.href}>
              <LinkComponent
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-bold"
              >
                <span
                  aria-hidden="true"
                  className={cn("flex size-7 items-center justify-center rounded-full", item.active && "bg-lime")}
                >
                  {item.icon}
                </span>
                {item.label}
              </LinkComponent>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
