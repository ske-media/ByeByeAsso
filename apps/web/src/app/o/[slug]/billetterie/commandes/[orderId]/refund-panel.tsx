"use client";

import { Alert, Button, FormField, Select, Textarea } from "@kroov/ui";
import { useActionState, useState, useTransition } from "react";
import { refundOrderAction, resendOrderAction } from "@/actions/ticketing";
import { type ActionState, idleState } from "@/lib/action-state";
import { fmtMinor } from "@/lib/money";

interface RefundableTicket {
  id: string;
  number: string;
  attendeeName: string | null;
  typeLabel: string;
  amountMinor: number;
  status: "valid" | "used";
}

const REASONS = ["Demande de l'acheteur", "Événement annulé", "Erreur de commande", "Geste commercial", "Autre"];

export function RefundPanel({
  organizationId,
  slug,
  orderId,
  currency,
  tickets,
  refundableMinor,
  canRefund,
}: {
  organizationId: string;
  slug: string;
  orderId: string;
  currency: string;
  tickets: RefundableTicket[];
  refundableMinor: number;
  canRefund: boolean;
}) {
  const [state, action, pending] = useActionState(
    refundOrderAction.bind(null, organizationId, slug, orderId),
    idleState,
  );
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState(REASONS[0] ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const amount =
    mode === "full"
      ? refundableMinor
      : tickets.filter((t) => selected.includes(t.id)).reduce((a, t) => a + t.amountMinor, 0);
  const count = mode === "full" ? tickets.length : selected.length;
  if (!canRefund)
    return (
      <p className="text-[13px] text-muted">Le remboursement est réservé aux personnes habilitées (orders.refund).</p>
    );
  if (tickets.length === 0)
    return <p className="text-[13px] text-muted">Aucun billet remboursable sur cette commande.</p>;
  return (
    <form action={action} noValidate className="space-y-3" key={state.status === "success" ? state.message : "refund"}>
      {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <p className="rounded-[9px] bg-orange px-3 py-2 text-[13px]">
        Cette action annulera {count} billet{count > 1 ? "s" : ""} et libérera {count} place{count > 1 ? "s" : ""}.
      </p>
      <FormField label="Périmètre" required>
        <Select name="mode" value={mode} onChange={(e) => setMode(e.target.value as "full" | "partial")}>
          <option value="full">Toute la commande</option>
          <option value="partial">Certains billets</option>
        </Select>
      </FormField>
      {mode === "partial" ? (
        <fieldset className="space-y-1 text-[13px]">
          <legend className="mb-1 font-bold">Billets à rembourser</legend>
          {tickets.map((t) => (
            <label
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-[9px] border border-border px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="ticketIds"
                  value={t.id}
                  checked={selected.includes(t.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                  className="size-4 accent-ink"
                />
                <span>
                  <b>{t.number}</b> · {t.attendeeName ?? t.typeLabel}
                  {t.status === "used" ? <span className="block text-[11px] text-muted">Déjà entré·e</span> : null}
                </span>
              </span>
              <span>{fmtMinor(t.amountMinor, currency)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <FormField
        label="Motif"
        required
        hint="Communiqué à l'acheteur et conservé dans le journal."
        error={errors.reason}
      >
        <Select
          value={REASONS.includes(reason) ? reason : "Autre"}
          onChange={(e) => setReason(e.target.value === "Autre" ? "" : e.target.value)}
          aria-label="Motif prédéfini"
        >
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Textarea
          name="reason"
          rows={2}
          maxLength={500}
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-2"
          placeholder="Précisez le motif"
        />
      </FormField>
      <dl className="m-0 flex justify-between text-[13px]">
        <dt>Montant remboursé</dt>
        <dd className="m-0 font-bold">{fmtMinor(amount, currency)}</dd>
      </dl>
      <p className="text-[12px] text-muted">
        Frais acheteur inclus. Le délai de retour dépend du prestataire de paiement et de la banque.
      </p>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="size-4 accent-ink"
        />
        Je confirme l'annulation de {count > 1 ? `ces ${count} billets` : "ce billet"}.
      </label>
      <Button
        type="submit"
        variant="danger"
        loading={pending}
        loadingLabel="Remboursement"
        disabled={!confirmed || count === 0 || reason.trim().length < 3}
        disabledReason="Confirmez et indiquez un motif."
      >
        Confirmer le remboursement
      </Button>
    </form>
  );
}

export function ResendButton({
  organizationId,
  slug,
  orderId,
}: {
  organizationId: string;
  slug: string;
  orderId: string;
}) {
  const [state, setState] = useState<ActionState>(idleState);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="secondary"
        loading={isPending}
        loadingLabel="Envoi"
        onClick={() => startTransition(async () => setState(await resendOrderAction(organizationId, slug, orderId)))}
      >
        Renvoyer les billets
      </Button>
      {state.status !== "idle" && state.message ? (
        <span className={`text-[12px] ${state.status === "error" ? "text-error-text" : "text-muted"}`}>
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
