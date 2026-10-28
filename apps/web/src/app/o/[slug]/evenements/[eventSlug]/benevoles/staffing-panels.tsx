"use client";

import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogPanel,
  DialogTrigger,
  FormField,
  Input,
  Select,
  Textarea,
} from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  activatePositionAction,
  cancelShiftAction,
  deactivatePositionAction,
  saveShiftAction,
  saveVolunteeringAction,
  setRecruitmentAction,
} from "@/actions/volunteers";
import { idleState } from "@/lib/action-state";

interface Ctx {
  organizationId: string;
  slug: string;
  eventId: string;
  eventSlug: string;
  timezone: string;
  canSchedule: boolean;
}

export interface ShiftItem {
  id: string;
  label: string | null;
  startsDate: string;
  startsTime: string;
  endsDate: string;
  endsTime: string;
  rangeLabel: string;
  requiredCount: number;
  maxCount: number;
  notes: string | null;
  status: "active" | "cancelled";
}

export interface EventPositionItem {
  id: string;
  positionId: string;
  name: string;
  teamName: string;
  skills: Array<{ name: string; mandatory: boolean }>;
  status: "active" | "archived";
  shifts: ShiftItem[];
  requiredTotal: number;
}

export interface QuestionItem {
  /** Stable client-side key (never persisted). */
  uid: string;
  label: string;
  type: "short_text" | "long_text" | "single_choice" | "checkbox";
  required: boolean;
  options: string[];
}

/** Ouverture / fermeture du recrutement : action principale unique, préconditions expliquées. */
export function RecruitmentControl({
  ctx,
  status,
  blockers,
}: {
  ctx: Ctx;
  status: "open" | "closed";
  blockers: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const run = (next: "open" | "closed") =>
    new Promise<void>((resolve) => {
      start(async () => {
        const r = await setRecruitmentAction(ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, next);
        setMessage(
          r.status === "error"
            ? { tone: "error", text: r.message ?? "Impossible." }
            : { tone: "success", text: r.status === "success" ? (r.message ?? "") : "" },
        );
        router.refresh();
        resolve();
      });
    });
  if (!ctx.canSchedule) return null;
  return (
    <div className="space-y-2">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {status === "open" ? (
        <ConfirmDialog
          trigger={<Button variant="secondary">Fermer le recrutement</Button>}
          title="Fermer le recrutement ?"
          description="La page publique n'accepte plus de candidature. Les candidatures reçues restent à examiner."
          confirmLabel="Fermer"
          pending={pending}
          onConfirm={() => run("closed")}
        />
      ) : (
        <>
          {blockers.length > 0 ? (
            <ul className="m-0 list-disc pl-5 text-[12px] text-muted">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          <Button
            variant="primary"
            loading={pending}
            loadingLabel="Ouverture"
            disabled={blockers.length > 0}
            disabledReason="Complétez les points ci-dessus avant d'ouvrir."
            onClick={() => void run("open")}
          >
            Ouvrir le recrutement
          </Button>
        </>
      )}
    </div>
  );
}

export function SettingsForm({
  ctx,
  initial,
}: {
  ctx: Ctx;
  initial: { targetCount: number; maxHoursPerDay: number; minRestMinutes: number; questions: QuestionItem[] };
}) {
  const [state, action, pending] = useActionState(
    saveVolunteeringAction.bind(null, ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const [questions, setQuestions] = useState<QuestionItem[]>(initial.questions);
  const update = (i: number, patch: Partial<QuestionItem>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <form action={action} noValidate className="space-y-3">
      {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <div className="grid gap-x-3 sm:grid-cols-3">
        <FormField label="Objectif de bénévoles" hint="Personnes acceptées visées." error={errors.targetCount}>
          <Input
            type="number"
            name="targetCount"
            min={0}
            defaultValue={String(initial.targetCount)}
            disabled={!ctx.canSchedule}
          />
        </FormField>
        <FormField label="Heures max. par jour" hint="0 = sans limite (planning)." error={errors.maxHoursPerDay}>
          <Input
            type="number"
            name="maxHoursPerDay"
            min={0}
            max={24}
            defaultValue={String(initial.maxHoursPerDay)}
            disabled={!ctx.canSchedule}
          />
        </FormField>
        <FormField label="Repos minimum (min)" hint="Entre deux créneaux (planning)." error={errors.minRestMinutes}>
          <Input
            type="number"
            name="minRestMinutes"
            min={0}
            max={1440}
            defaultValue={String(initial.minRestMinutes)}
            disabled={!ctx.canSchedule}
          />
        </FormField>
      </div>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 text-[12px] font-bold">Questions personnalisées (formulaire de candidature)</legend>
        {questions.length === 0 ? (
          <p className="text-[12px] text-muted">Aucune question en plus des informations de base.</p>
        ) : null}
        <ul className="m-0 list-none space-y-2 p-0">
          {questions.map((q, i) => (
            <li
              key={q.uid}
              className="grid gap-2 rounded-[9px] border border-border p-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]"
            >
              <input type="hidden" name="questionRequired" value={q.required ? "1" : "0"} />
              <input type="hidden" name="questionOptions" value={q.options.join(", ")} />
              <Input
                name="questionLabel"
                value={q.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Intitulé de la question"
                aria-label={`Question ${i + 1}`}
                disabled={!ctx.canSchedule}
              />
              <Select
                name="questionType"
                value={q.type}
                onChange={(e) => update(i, { type: e.target.value as QuestionItem["type"] })}
                aria-label="Type"
                disabled={!ctx.canSchedule}
              >
                <option value="short_text">Texte court</option>
                <option value="long_text">Texte long</option>
                <option value="single_choice">Choix unique</option>
                <option value="checkbox">Oui / non</option>
              </Select>
              <span className="flex items-center gap-2 text-[12px]">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => update(i, { required: e.target.checked })}
                    className="size-4 accent-ink"
                    disabled={!ctx.canSchedule}
                  />
                  Obligatoire
                </label>
                {ctx.canSchedule ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                  >
                    Retirer
                  </button>
                ) : null}
              </span>
              {q.type === "single_choice" ? (
                <Input
                  className="sm:col-span-3"
                  value={q.options.join(", ")}
                  onChange={(e) =>
                    update(i, {
                      options: e.target.value
                        .split(",")
                        .map((o) => o.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Options séparées par des virgules : S, M, L"
                  aria-label="Options"
                  disabled={!ctx.canSchedule}
                />
              ) : null}
            </li>
          ))}
        </ul>
        {ctx.canSchedule && questions.length < 12 ? (
          <Button
            type="button"
            variant="ghost"
            className="mt-2 min-h-9 text-[12px]"
            onClick={() =>
              setQuestions((qs) => [
                ...qs,
                { uid: `q-${Date.now()}`, label: "", type: "short_text", required: false, options: [] },
              ])
            }
          >
            + Ajouter une question
          </Button>
        ) : null}
      </fieldset>
      {ctx.canSchedule ? (
        <Button type="submit" variant="secondary" loading={pending} loadingLabel="Enregistrement">
          Enregistrer les réglages
        </Button>
      ) : null}
    </form>
  );
}

function ShiftForm({
  ctx,
  eventPositionId,
  initial,
  onDone,
}: {
  ctx: Ctx;
  eventPositionId: string;
  initial: ShiftItem | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    saveShiftAction.bind(
      null,
      ctx.organizationId,
      ctx.slug,
      ctx.eventId,
      ctx.eventSlug,
      eventPositionId,
      initial?.id ?? null,
      ctx.timezone,
    ),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const v = state.status === "error" ? (state.values ?? {}) : {};
  if (state.status === "success") {
    router.refresh();
    onDone();
  }
  return (
    <form action={action} noValidate className="space-y-2">
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <FormField label="Libellé" hint="Facultatif : « Ouverture », « Nuit »…" error={errors.label}>
        <Input name="label" maxLength={80} defaultValue={v.label ?? initial?.label ?? ""} />
      </FormField>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormField label="Début (date)" required error={errors.startsDate}>
          <Input type="date" name="startsDate" required defaultValue={v.startsDate ?? initial?.startsDate ?? ""} />
        </FormField>
        <FormField label="Début (heure)" required error={errors.startsTime}>
          <Input type="time" name="startsTime" required defaultValue={v.startsTime ?? initial?.startsTime ?? "18:00"} />
        </FormField>
        <FormField label="Fin (date)" required error={errors.endsDate}>
          <Input type="date" name="endsDate" required defaultValue={v.endsDate ?? initial?.endsDate ?? ""} />
        </FormField>
        <FormField label="Fin (heure)" required error={errors.endsAt ?? errors.endsTime}>
          <Input type="time" name="endsTime" required defaultValue={v.endsTime ?? initial?.endsTime ?? "23:00"} />
        </FormField>
        <FormField label="Effectif requis" required error={errors.requiredCount}>
          <Input
            type="number"
            name="requiredCount"
            min={0}
            max={500}
            defaultValue={v.requiredCount ?? String(initial?.requiredCount ?? 1)}
          />
        </FormField>
        <FormField label="Effectif maximum" hint="Vide = égal au requis." error={errors.maxCount}>
          <Input
            type="number"
            name="maxCount"
            min={0}
            max={500}
            defaultValue={v.maxCount ?? (initial ? String(initial.maxCount) : "")}
          />
        </FormField>
      </div>
      <FormField label="Notes" error={errors.notes}>
        <Textarea name="notes" rows={2} maxLength={1000} defaultValue={v.notes ?? initial?.notes ?? ""} />
      </FormField>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
          {initial ? "Enregistrer" : "Ajouter le créneau"}
        </Button>
      </div>
    </form>
  );
}

export function PositionsPanel({
  ctx,
  eventPositions,
  availableTemplates,
}: {
  ctx: Ctx;
  eventPositions: EventPositionItem[];
  availableTemplates: Array<{ id: string; name: string; teamName: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [shiftDialog, setShiftDialog] = useState<{ eventPositionId: string; shift: ShiftItem | null } | null>(null);
  const [template, setTemplate] = useState("");
  const active = eventPositions.filter((p) => p.status === "active");
  const act = (fn: () => Promise<{ status: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.message ?? null);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      {message ? <Alert tone="info">{message}</Alert> : null}
      {active.length === 0 ? (
        <p className="text-[13px] text-muted">Aucun poste activé sur cet événement.</p>
      ) : (
        <div className="space-y-3">
          {active.map((p) => (
            <section key={p.id} className="rounded-[9px] border border-border p-3">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="m-0 text-[14px] font-bold">
                  {p.name} <span className="text-[11px] font-normal text-muted">· {p.teamName}</span>
                  <span className="ml-2 text-[11px] font-normal text-muted">
                    {p.requiredTotal} affectation(s) requise(s)
                  </span>
                </h3>
                {ctx.canSchedule ? (
                  <span className="flex gap-1">
                    <Button
                      variant="secondary"
                      className="min-h-9 text-[12px]"
                      onClick={() => setShiftDialog({ eventPositionId: p.id, shift: null })}
                    >
                      + Créneau
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" className="min-h-9 text-[12px]">
                          Retirer
                        </Button>
                      }
                      title={`Retirer « ${p.name} » de l'événement ?`}
                      description="Ses créneaux sont annulés. Les candidatures qui le demandaient restent valides."
                      confirmLabel="Retirer"
                      destructive
                      pending={pending}
                      onConfirm={() =>
                        new Promise<void>((resolve) => {
                          act(() =>
                            deactivatePositionAction(ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, p.id),
                          );
                          resolve();
                        })
                      }
                    />
                  </span>
                ) : null}
              </header>
              {p.skills.length > 0 ? (
                <p className="mt-1 text-[11px] text-muted">
                  {p.skills.map((s) => `${s.name}${s.mandatory ? " (obligatoire)" : ""}`).join(" · ")}
                </p>
              ) : null}
              {p.shifts.filter((s) => s.status === "active").length === 0 ? (
                <p className="mt-2 text-[12px] text-muted">Aucun créneau : ajoutez-en pour définir les besoins.</p>
              ) : (
                <ul className="m-0 mt-2 list-none divide-y divide-border p-0 text-[13px]">
                  {p.shifts
                    .filter((s) => s.status === "active")
                    .map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>
                          <b>{s.label ?? "Créneau"}</b> · {s.rangeLabel}
                          <span className="block text-[11px] text-muted">
                            {s.requiredCount} requis{s.maxCount > s.requiredCount ? ` · ${s.maxCount} max.` : ""}
                            {s.notes ? ` · ${s.notes}` : ""}
                          </span>
                        </span>
                        {ctx.canSchedule ? (
                          <span className="flex gap-1">
                            <Button
                              variant="ghost"
                              className="min-h-9 text-[12px]"
                              onClick={() => setShiftDialog({ eventPositionId: p.id, shift: s })}
                            >
                              Modifier
                            </Button>
                            <ConfirmDialog
                              trigger={
                                <Button variant="ghost" className="min-h-9 text-[12px]">
                                  Annuler
                                </Button>
                              }
                              title="Annuler ce créneau ?"
                              description="Il disparaît des besoins ; l'historique le conserve."
                              confirmLabel="Annuler le créneau"
                              destructive
                              pending={pending}
                              onConfirm={() =>
                                new Promise<void>((resolve) => {
                                  act(() =>
                                    cancelShiftAction(ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, s.id),
                                  );
                                  resolve();
                                })
                              }
                            />
                          </span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      {ctx.canSchedule ? (
        availableTemplates.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <FormField label="Activer un poste type" className="mb-0 min-w-[240px]">
              <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Choisir…</option>
                {availableTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.teamName}
                  </option>
                ))}
              </Select>
            </FormField>
            <Button
              variant="secondary"
              disabled={!template}
              disabledReason="Choisissez un poste."
              loading={pending}
              loadingLabel="Activation"
              onClick={() => {
                const id = template;
                setTemplate("");
                act(() => activatePositionAction(ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, id));
              }}
            >
              Activer
            </Button>
          </div>
        ) : (
          <p className="text-[12px] text-muted">
            Tous les postes types sont activés, ou aucun n'existe : créez-en dans « Bénévoles › Équipes & postes ».
          </p>
        )
      ) : null}
      <Dialog
        open={shiftDialog !== null}
        onOpenChange={(o) => {
          if (!o) setShiftDialog(null);
        }}
      >
        <DialogTrigger asChild>
          <span className="hidden" />
        </DialogTrigger>
        <DialogPanel
          title={shiftDialog?.shift ? "Modifier le créneau" : "Nouveau créneau"}
          description="Dans la fenêtre de l'événement (la veille au lendemain), 24 h au plus."
        >
          {shiftDialog ? (
            <ShiftForm
              key={shiftDialog.shift?.id ?? "new"}
              ctx={ctx}
              eventPositionId={shiftDialog.eventPositionId}
              initial={shiftDialog.shift}
              onDone={() => setShiftDialog(null)}
            />
          ) : null}
        </DialogPanel>
      </Dialog>
    </div>
  );
}

export function CoverageBadge({ coverage }: { coverage: "full" | "partial" | "none" }) {
  const tone = { full: "lime", partial: "orange", none: "neutral" } as const;
  const label = { full: "✓", partial: "◐", none: "—" } as const;
  return (
    <Badge tone={tone[coverage]} noDot>
      <span className="k-sr-only">
        {{ full: "disponible", partial: "partiellement", none: "indisponible" }[coverage]}
      </span>
      <span aria-hidden="true">{label[coverage]}</span>
    </Badge>
  );
}
