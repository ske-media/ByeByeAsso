"use client";

import type { EventStatus } from "@kroov/domain/events";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogPanel,
  DialogTrigger,
  FormField,
  Textarea,
} from "@kroov/ui";
import { useActionState, useState, useTransition } from "react";
import { archiveEventAction, cancelEventAction, deleteDraftEventAction } from "@/actions/events";
import { type ActionState, idleState } from "@/lib/action-state";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-control border border-border bg-canvas px-3 py-2 text-[12px]">
        {url}
      </code>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copié ✓" : "Copier le lien"}
      </Button>
      <Button asChild size="sm" variant="ghost">
        <a href={url} target="_blank" rel="noreferrer">
          Ouvrir ↗
        </a>
      </Button>
    </div>
  );
}

export function EventLifecycleActions({
  organizationId,
  slug,
  event,
  permissions,
}: {
  organizationId: string;
  slug: string;
  event: { id: string; slug: string; title: string; status: EventStatus; version: number };
  permissions: { update: boolean; cancel: boolean };
}) {
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelEventAction.bind(null, organizationId, slug, event.id),
    idleState,
  );
  const [result, setResult] = useState<ActionState>(idleState);
  const [isPending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);

  const canArchive =
    permissions.update && (event.status === "draft" || event.status === "completed" || event.status === "cancelled");
  const canDelete = permissions.update && event.status === "draft";
  const canCancel = permissions.cancel && (event.status === "published" || event.status === "suspended");

  if (!canArchive && !canDelete && !canCancel) {
    return <p className="text-[13px] text-muted">Aucune action disponible pour votre rôle ou pour cet état.</p>;
  }

  return (
    <div className="space-y-3">
      {cancelState.status === "success" ? <Alert tone="success">{cancelState.message}</Alert> : null}
      {result.status === "error" ? <Alert tone="error">{result.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {canCancel ? (
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogTrigger asChild>
              <Button variant="danger">Annuler l'événement</Button>
            </DialogTrigger>
            <DialogPanel
              title={`Annuler « ${event.title} » ?`}
              description="L'événement restera consultable avec la mention « annulé ». Cette décision est définitive et tracée. Les remboursements seront gérés avec la billetterie."
            >
              <form action={cancelAction} noValidate>
                <input type="hidden" name="version" value={event.version} />
                {cancelState.status === "error" ? (
                  <Alert tone="error" className="mb-3">
                    {cancelState.message}
                  </Alert>
                ) : null}
                <FormField
                  label="Motif"
                  required
                  hint="Communiqué aux participants et conservé dans le journal."
                  error={cancelState.status === "error" ? cancelState.fieldErrors?.reason : undefined}
                >
                  <Textarea name="reason" required minLength={5} maxLength={1000} rows={3} />
                </FormField>
                <div className="flex flex-wrap justify-end gap-2">
                  <DialogClose asChild>
                    <Button variant="secondary">Conserver l'événement</Button>
                  </DialogClose>
                  <Button type="submit" variant="danger" loading={cancelPending} loadingLabel="Annulation">
                    Confirmer l'annulation
                  </Button>
                </div>
              </form>
            </DialogPanel>
          </Dialog>
        ) : null}
        {canArchive ? (
          <ConfirmDialog
            trigger={<Button variant="secondary">Archiver</Button>}
            title="Archiver cet événement ?"
            description="Un événement archivé n'est plus modifiable ni visible publiquement. Il reste dans votre historique."
            confirmLabel="Archiver"
            pending={isPending}
            onConfirm={() =>
              startTransition(async () =>
                setResult(await archiveEventAction(organizationId, slug, event.id, event.version)),
              )
            }
          />
        ) : null}
        {canDelete ? (
          <ConfirmDialog
            trigger={<Button variant="ghost">Supprimer le brouillon</Button>}
            title="Supprimer ce brouillon ?"
            description="Le brouillon et ses réglages seront définitivement supprimés. Un événement publié ne peut jamais être supprimé : il s'annule puis s'archive."
            confirmLabel="Supprimer"
            destructive
            pending={isPending}
            onConfirm={() =>
              startTransition(async () => setResult(await deleteDraftEventAction(organizationId, slug, event.id)))
            }
          />
        ) : null}
      </div>
    </div>
  );
}
