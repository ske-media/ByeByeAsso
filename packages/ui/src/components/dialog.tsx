"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type * as React from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

/**
 * ConfirmDialog — intitulé concret, conséquence, périmètre, action d'annulation.
 * Focus piégé puis rendu au déclencheur (Radix). Un clic hors de la modale ferme sans agir.
 */
export interface ConfirmDialogProps {
  trigger: React.ReactNode;
  title: string;
  /** Conséquence et périmètre, en phrases complètes. */
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive decisions use the bordeaux button. */
  destructive?: boolean;
  /** Called on confirm; the dialog closes when the promise resolves. */
  onConfirm: () => Promise<void> | void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  pending?: boolean;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Annuler",
  destructive = false,
  onConfirm,
  open,
  onOpenChange,
  children,
  pending = false,
}: ConfirmDialogProps) {
  return (
    <DialogPrimitive.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100%-32px)] max-w-[480px] -translate-x-1/2 -translate-y-1/2",
            "rounded-panel border border-ink bg-surface p-6 shadow-[6px_6px_0_0_var(--color-ink)]",
          )}
        >
          <DialogPrimitive.Title className="text-panel-title font-bold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-muted">{description}</DialogPrimitive.Description>
          {children ? <div className="mt-4">{children}</div> : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </DialogPrimitive.Close>
            <Button
              variant={destructive ? "danger" : "primary"}
              loading={pending}
              onClick={() => {
                void onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogPanel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          "rounded-panel border border-ink bg-surface p-6 shadow-[6px_6px_0_0_var(--color-ink)]",
          className,
        )}
      >
        <DialogPrimitive.Title className="text-panel-title font-bold">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-2 text-muted">{description}</DialogPrimitive.Description>
        ) : null}
        <div className="mt-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
