"use client";

import type { VolunteerApplicationStatus } from "@kroov/domain/volunteers";
import { Alert, Button, ConfirmDialog, FormField, Input, Select, Textarea } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  type DecisionAction,
  decideAction,
  saveInternalNotesAction,
  staffEditApplicationAction,
  verifySkillAction,
} from "@/actions/volunteers";
import { idleState } from "@/lib/action-state";

interface Ctx {
  organizationId: string;
  slug: string;
  applicationId: string;
}

/** Décisions : accepter, liste d'attente, à l'étude, non retenue (motif obligatoire). */
export function DecisionsPanel({ ctx, status }: { ctx: Ctx; status: VolunteerApplicationStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const run = (action: DecisionAction) =>
    new Promise<void>((resolve) => {
      start(async () => {
        const r = await decideAction(ctx.organizationId, ctx.slug, ctx.applicationId, action, reason || undefined);
        setMessage(
          r.status === "error"
            ? { tone: "error", text: r.message ?? "Action impossible." }
            : { tone: "success", text: r.status === "success" ? (r.message ?? "") : "" },
        );
        setReason("");
        router.refresh();
        resolve();
      });
    });
  const closed = status === "rejected" || status === "withdrawn";
  const canApprove = ["submitted", "under_review", "waitlisted"].includes(status);
  const canWaitlist = ["submitted", "under_review", "approved"].includes(status);
  const canReview = status === "submitted";
  const canReject = !closed && !["assigned", "confirmed"].includes(status);
  return (
    <div className="space-y-3">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {closed ? (
        <p className="text-[13px] text-muted">Candidature close : aucune décision possible.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canApprove ? (
            <ConfirmDialog
              trigger={<Button variant="primary">Accepter</Button>}
              title="Accepter cette candidature ?"
              description="La personne reçoit un e-mail. Accepter ne publie pas de mission : les créneaux sont attribués au planning."
              confirmLabel="Accepter"
              pending={pending}
              onConfirm={() => run("approve")}
            />
          ) : null}
          {canWaitlist ? (
            <ConfirmDialog
              trigger={<Button variant="secondary">Liste d'attente</Button>}
              title="Placer en liste d'attente ?"
              description="La personne est informée et invitée à élargir ses vœux ou ses disponibilités."
              confirmLabel="Placer en attente"
              pending={pending}
              onConfirm={() => run("waitlist")}
            />
          ) : null}
          {canReview ? (
            <Button variant="secondary" loading={pending} loadingLabel="Mise à jour" onClick={() => void run("review")}>
              Marquer à l'étude
            </Button>
          ) : null}
          {canReject ? (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" className="text-bordeaux">
                  Non retenue
                </Button>
              }
              title="Ne pas retenir cette candidature ?"
              description="Décision définitive. Le motif ci-dessous est transmis à la personne ; vos notes internes ne le sont jamais."
              confirmLabel="Confirmer le refus"
              destructive
              pending={pending}
              onConfirm={() => run("reject")}
            >
              <FormField label="Motif communiqué" required hint="3 à 500 caractères.">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
              </FormField>
            </ConfirmDialog>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function InternalNotesForm({ ctx, notes }: { ctx: Ctx; notes: string }) {
  const [state, action, pending] = useActionState(
    saveInternalNotesAction.bind(null, ctx.organizationId, ctx.slug, ctx.applicationId),
    idleState,
  );
  return (
    <form action={action} className="space-y-2">
      {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert tone="error">{state.message ?? "Enregistrement impossible."}</Alert> : null}
      <FormField label="Notes internes" hint="Visibles de l'équipe uniquement. Jamais transmises au candidat.">
        <Textarea name="internalNotes" rows={4} maxLength={4000} defaultValue={notes} />
      </FormField>
      <Button type="submit" variant="secondary" loading={pending} loadingLabel="Enregistrement">
        Enregistrer les notes
      </Button>
    </form>
  );
}

export function VerifySkillButton({ ctx, skillId, verified }: { ctx: Ctx; skillId: string; verified: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={verified ? "ghost" : "secondary"}
      className="min-h-9 text-[12px]"
      loading={pending}
      loadingLabel="Mise à jour"
      onClick={() =>
        start(async () => {
          await verifySkillAction(ctx.organizationId, ctx.slug, ctx.applicationId, skillId, !verified);
          router.refresh();
        })
      }
    >
      {verified ? "Retirer la vérification" : "Marquer vérifiée"}
    </Button>
  );
}

export function StaffEditForm({
  ctx,
  initial,
  positions,
  editable,
}: {
  ctx: Ctx;
  initial: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    constraints: string;
    preferences: string[];
  };
  positions: Array<{ id: string; name: string }>;
  editable: boolean;
}) {
  const [state, action, pending] = useActionState(
    staffEditApplicationAction.bind(null, ctx.organizationId, ctx.slug, ctx.applicationId),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const [prefs, setPrefs] = useState<string[]>(initial.preferences);
  if (!editable) return <p className="text-[13px] text-muted">Candidature close : modification impossible.</p>;
  return (
    <form action={action} noValidate className="space-y-2">
      {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormField label="Prénom" error={errors.firstName}>
          <Input name="firstName" defaultValue={initial.firstName} />
        </FormField>
        <FormField label="Nom" error={errors.lastName}>
          <Input name="lastName" defaultValue={initial.lastName} />
        </FormField>
        <FormField label="E-mail" error={errors.email}>
          <Input name="email" type="email" defaultValue={initial.email} />
        </FormField>
        <FormField label="Téléphone" error={errors.phone}>
          <Input name="phone" defaultValue={initial.phone} />
        </FormField>
      </div>
      <FormField label="Contraintes" error={errors.constraints}>
        <Textarea name="constraints" rows={2} maxLength={1000} defaultValue={initial.constraints} />
      </FormField>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 text-[12px] font-bold">Vœux de postes (ordre)</legend>
        {errors.positionPreferences ? (
          <p className="text-[11px] text-error-text">{errors.positionPreferences.join(" ")}</p>
        ) : null}
        <ol className="m-0 list-none space-y-1 p-0">
          {prefs.map((id, i) => (
            <li key={id} className="flex items-center gap-2 text-[13px]">
              <span className="w-5 text-muted">{i + 1}.</span>
              <input type="hidden" name="positionPreferences" value={id} />
              <span className="flex-1">{positions.find((p) => p.id === id)?.name ?? id}</span>
              <button
                type="button"
                className="text-[12px] underline"
                disabled={i === 0}
                onClick={() =>
                  setPrefs((p) => {
                    const n = [...p];
                    [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
                    return n;
                  })
                }
              >
                ↑
              </button>
              <button
                type="button"
                className="text-[12px] underline"
                onClick={() => setPrefs((p) => p.filter((x) => x !== id))}
              >
                Retirer
              </button>
            </li>
          ))}
        </ol>
        {positions.filter((p) => !prefs.includes(p.id)).length > 0 ? (
          <Select
            aria-label="Ajouter un vœu"
            value=""
            onChange={(e) => {
              if (e.target.value) setPrefs((p) => [...p, e.target.value]);
            }}
            className="mt-2"
          >
            <option value="">+ Ajouter un poste…</option>
            {positions
              .filter((p) => !prefs.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        ) : null}
      </fieldset>
      <Button type="submit" variant="secondary" loading={pending} loadingLabel="Enregistrement">
        Enregistrer les modifications
      </Button>
    </form>
  );
}
