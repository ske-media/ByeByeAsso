"use client";

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogPanel,
  DialogTrigger,
  EmptyState,
  FormField,
  Input,
  Select,
  Table,
  TableContainer,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
} from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { liftSuppressionAction, suppressAction } from "@/actions/crm";
import { idleState } from "@/lib/action-state";
import { SOURCE_LABELS, SUPPRESSION_LABELS } from "../labels";

interface Ctx {
  organizationId: string;
  slug: string;
}

export interface SuppressionRow {
  id: string;
  email: string;
  reason: string;
  source: string;
  note: string | null;
  createdBy: string | null;
  created: string;
  lifted: string | null;
  liftReason: string | null;
}

function AddForm({ ctx, onDone }: { ctx: Ctx; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(suppressAction.bind(null, ctx.organizationId, ctx.slug), idleState);
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
      <FormField label="Adresse e-mail" required error={errors.email}>
        <Input name="email" type="email" required />
      </FormField>
      <FormField label="Motif" required>
        <Select name="reason" defaultValue="manual">
          {Object.entries(SUPPRESSION_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Note (facultatif)" error={errors.note}>
        <Textarea name="note" rows={2} maxLength={500} placeholder="Demande reçue par e-mail le…" />
      </FormField>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="…">
          Exclure cette adresse
        </Button>
      </div>
    </form>
  );
}

function LiftForm({ ctx, row, onDone }: { ctx: Ctx; row: SuppressionRow; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    liftSuppressionAction.bind(null, ctx.organizationId, ctx.slug, row.id),
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
      <p className="text-[13px]">
        Lever l'exclusion de <b>{row.email}</b> ? La personne redevient joignable selon son consentement enregistré.
      </p>
      <FormField label="Motif de la levée" required error={errors.reason} hint="Tracé dans l'audit.">
        <Textarea
          name="reason"
          rows={2}
          maxLength={500}
          required
          placeholder="Erreur de saisie confirmée par la personne"
        />
      </FormField>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="…">
          Lever l'exclusion
        </Button>
      </div>
    </form>
  );
}

export function SuppressionsPanel({ ctx, canManage, rows }: { ctx: Ctx; canManage: boolean; rows: SuppressionRow[] }) {
  const [open, setOpen] = useState<"new" | string | null>(null);
  const lifting = open && open !== "new" ? (rows.find((r) => r.id === open) ?? null) : null;
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <EmptyState
          title="Aucune exclusion"
          description="Les désinscriptions, rebonds et demandes d'effacement apparaîtront ici."
        />
      ) : (
        <TableContainer label="Exclusions" className="border-0 bg-transparent">
          <Table>
            <THead>
              <TR>
                <TH>Adresse</TH>
                <TH>Motif</TH>
                <TH>Origine</TH>
                <TH>Depuis</TH>
                <TH>État</TH>
                <TH>
                  <span className="k-sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <b>{r.email}</b>
                    {r.note ? <span className="block text-[11px] text-muted">{r.note}</span> : null}
                  </TD>
                  <TD>{SUPPRESSION_LABELS[r.reason] ?? r.reason}</TD>
                  <TD className="text-[12px]">
                    {SOURCE_LABELS[r.source] ?? r.source}
                    {r.createdBy ? ` · ${r.createdBy}` : ""}
                  </TD>
                  <TD className="text-[12px]">{r.created}</TD>
                  <TD>
                    {r.lifted ? (
                      <span className="text-[12px]">
                        <Badge tone="neutral" noDot>
                          levée le {r.lifted}
                        </Badge>
                        {r.liftReason ? <span className="block text-[11px] text-muted">{r.liftReason}</span> : null}
                      </span>
                    ) : (
                      <Badge tone="error">Exclue</Badge>
                    )}
                  </TD>
                  <TD className="text-right">
                    {canManage && !r.lifted ? (
                      <Button variant="ghost" className="min-h-9 text-[12px]" onClick={() => setOpen(r.id)}>
                        Lever…
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
      {canManage ? (
        <Dialog open={open !== null} onOpenChange={(o) => setOpen(o ? (open ?? "new") : null)}>
          <DialogTrigger asChild>
            <Button variant="secondary" onClick={() => setOpen("new")}>
              + Exclure une adresse
            </Button>
          </DialogTrigger>
          <DialogPanel title={lifting ? "Lever une exclusion" : "Exclure une adresse des envois"}>
            {lifting ? (
              <LiftForm key={lifting.id} ctx={ctx} row={lifting} onDone={() => setOpen(null)} />
            ) : (
              <AddForm key="new" ctx={ctx} onDone={() => setOpen(null)} />
            )}
          </DialogPanel>
        </Dialog>
      ) : null}
    </div>
  );
}
