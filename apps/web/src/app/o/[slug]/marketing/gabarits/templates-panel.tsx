"use client";

import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogPanel,
  DialogTrigger,
  EmptyState,
  FormField,
  Input,
  Panel,
  PanelTitle,
  Textarea,
} from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { archiveTemplateAction, saveTemplateAction } from "@/actions/marketing";
import { idleState } from "@/lib/action-state";

interface Ctx {
  organizationId: string;
  slug: string;
}
export interface TemplateItem {
  id: string;
  name: string;
  subject: string;
  preheader: string;
  body: string;
}

function TemplateForm({ ctx, initial, onDone }: { ctx: Ctx; initial: TemplateItem | null; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    saveTemplateAction.bind(null, ctx.organizationId, ctx.slug, initial?.id ?? null),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onDone();
    }
  }, [state.status, router, onDone]);
  return (
    <form action={action} noValidate className="space-y-2">
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <FormField label="Nom" required error={errors.name}>
        <Input
          name="name"
          required
          maxLength={120}
          defaultValue={initial?.name ?? ""}
          placeholder="Annonce d'événement"
        />
      </FormField>
      <FormField label="Objet" error={errors.subject}>
        <Input
          name="subject"
          maxLength={200}
          defaultValue={initial?.subject ?? ""}
          placeholder="{{organisation}} : du nouveau"
        />
      </FormField>
      <FormField label="Pré-en-tête" error={errors.preheader}>
        <Input name="preheader" maxLength={200} defaultValue={initial?.preheader ?? ""} />
      </FormField>
      <FormField label="Corps (Markdown restreint)" error={errors.body}>
        <Textarea
          name="body"
          rows={10}
          maxLength={20000}
          defaultValue={initial?.body ?? ""}
          className="font-mono text-[13px]"
        />
      </FormField>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
          {initial ? "Enregistrer" : "Créer le gabarit"}
        </Button>
      </div>
    </form>
  );
}

export function TemplatesPanel({ ctx, templates }: { ctx: Ctx; templates: TemplateItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<"new" | string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editing = open && open !== "new" ? (templates.find((t) => t.id === open) ?? null) : null;
  return (
    <Panel>
      <PanelTitle>Gabarits</PanelTitle>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {templates.length === 0 ? (
        <EmptyState
          title="Aucun gabarit"
          description="Un gabarit pré-remplit l'objet et le corps d'une nouvelle campagne."
        />
      ) : (
        <ul className="m-0 mt-3 list-none divide-y divide-border p-0">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span>
                <b>{t.name}</b>
                <span className="block text-[11px] text-muted">{t.subject || "— sans objet —"}</span>
              </span>
              <span className="flex gap-1">
                <Button variant="ghost" className="min-h-9 text-[12px]" onClick={() => setOpen(t.id)}>
                  Modifier
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" className="min-h-9 text-[12px] text-bordeaux">
                      Archiver
                    </Button>
                  }
                  title={`Archiver « ${t.name} » ?`}
                  description="Il ne sera plus proposé ; les campagnes existantes ne changent pas."
                  confirmLabel="Archiver"
                  destructive
                  pending={pending}
                  onConfirm={() =>
                    new Promise<void>((resolve) => {
                      start(async () => {
                        const r = await archiveTemplateAction(ctx.organizationId, ctx.slug, t.id);
                        if (r.status === "error") setError(r.message ?? "Impossible.");
                        else router.refresh();
                        resolve();
                      });
                    })
                  }
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => setOpen(o ? (open ?? "new") : null)}>
        <DialogTrigger asChild>
          <Button variant="secondary" className="mt-3" onClick={() => setOpen("new")}>
            + Nouveau gabarit
          </Button>
        </DialogTrigger>
        <DialogPanel title={editing ? `Modifier « ${editing.name} »` : "Nouveau gabarit"}>
          <TemplateForm key={open ?? "closed"} ctx={ctx} initial={editing} onDone={() => setOpen(null)} />
        </DialogPanel>
      </Dialog>
    </Panel>
  );
}
