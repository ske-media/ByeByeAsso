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
  assignAction,
  attendanceAction,
  createVersionAction,
  generateAction,
  lockAction,
  publishAction,
  resolveRequestAction,
  reviewAction,
  unassignAction,
} from "@/actions/scheduling";
import { idleState } from "@/lib/action-state";

export interface Ctx {
  organizationId: string;
  slug: string;
  eventId: string;
  eventSlug: string;
  canSchedule: boolean;
  canPublish: boolean;
}

export interface SlotAssignment {
  id: string;
  applicationId: string;
  volunteerName: string;
  source: "auto" | "manual";
  locked: boolean;
  confirmationStatus: "pending" | "confirmed" | "declined";
  openRequest: { id: string; kind: string; message: string | null } | null;
  attendance: { status: string; note: string | null } | null;
  conflict: string | null;
}

export interface SlotView {
  shiftId: string;
  positionName: string;
  teamName: string;
  label: string | null;
  rangeLabel: string;
  requiredCount: number;
  maxCount: number;
  missing: number;
  assignments: SlotAssignment[];
  candidates: Array<{ applicationId: string; name: string; preferenceRank: number | null }>;
  excluded: Array<{ applicationId: string; name: string; label: string }>;
}

function useFeedback() {
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const apply = (r: { status: string; message?: string }) =>
    setMessage(
      r.status === "error"
        ? { tone: "error", text: r.message ?? "Action impossible." }
        : { tone: "success", text: r.message ?? "" },
    );
  return { message, apply };
}

/** Écran 14 — proposition : créer une version et lancer le moteur. */
export function VersionActions({
  ctx,
  versionId,
  status,
  editable,
  basedOnPublishedId,
}: {
  ctx: Ctx;
  versionId: string | null;
  status: string | null;
  editable: boolean;
  basedOnPublishedId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { message, apply } = useFeedback();
  if (!ctx.canSchedule) return null;
  return (
    <div className="space-y-2">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {versionId && editable ? (
          <Button
            variant="primary"
            loading={pending}
            loadingLabel="Génération"
            onClick={() =>
              start(async () => {
                apply(await generateAction(ctx.organizationId, ctx.slug, ctx.eventSlug, versionId, null));
                router.refresh();
              })
            }
          >
            {status === "draft" ? "Générer une proposition" : "Régénérer (verrous conservés)"}
          </Button>
        ) : null}
        <Button
          variant={versionId && editable ? "secondary" : "primary"}
          loading={pending}
          loadingLabel="Création"
          onClick={() =>
            start(async () => {
              const r = await createVersionAction(ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, null, true);
              if (r) apply(r);
            })
          }
        >
          Nouvelle version + proposition
        </Button>
        {basedOnPublishedId ? (
          <Button
            variant="secondary"
            loading={pending}
            loadingLabel="Création"
            onClick={() =>
              start(async () => {
                const r = await createVersionAction(
                  ctx.organizationId,
                  ctx.slug,
                  ctx.eventId,
                  ctx.eventSlug,
                  basedOnPublishedId,
                  false,
                );
                if (r) apply(r);
              })
            }
          >
            Version de travail à partir de la publiée
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AssignForm({
  ctx,
  versionId,
  slot,
  onDone,
}: {
  ctx: Ctx;
  versionId: string;
  slot: SlotView;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    assignAction.bind(null, ctx.organizationId, ctx.slug, ctx.eventSlug, versionId),
    idleState,
  );
  if (state.status === "success") {
    router.refresh();
    onDone(state.message ?? "Affectation ajoutée.");
  }
  return (
    <form action={action} noValidate className="space-y-2">
      {state.status === "error" ? <Alert tone="error">{state.message ?? "Affectation impossible."}</Alert> : null}
      <input type="hidden" name="shiftId" value={slot.shiftId} />
      {slot.candidates.length === 0 ? (
        <p className="text-[13px] text-muted">Personne ne peut prendre ce créneau sans violer une contrainte dure.</p>
      ) : (
        <FormField label="Bénévole éligible" required hint="Triés par vœu : 1 = ce poste est leur premier choix.">
          <Select name="applicationId" defaultValue={slot.candidates[0]?.applicationId}>
            {slot.candidates.map((c) => (
              <option key={c.applicationId} value={c.applicationId}>
                {c.name}
                {c.preferenceRank ? ` · vœu n°${c.preferenceRank}` : " · poste non demandé"}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="lock" className="size-4 accent-ink" />
        Verrouiller (conservée par les régénérations)
      </label>
      {slot.excluded.length > 0 ? (
        <details className="text-[12px] text-muted">
          <summary className="cursor-pointer">Pourquoi les autres ne peuvent pas ({slot.excluded.length})</summary>
          <ul className="m-0 mt-1 list-disc pl-5">
            {slot.excluded.map((e) => (
              <li key={e.applicationId}>
                {e.name} — {e.label}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          loadingLabel="Affectation"
          disabled={slot.candidates.length === 0}
        >
          Affecter
        </Button>
      </div>
    </form>
  );
}

/** Écran 15 — arbitrage : grille créneaux × places, verrous, retraits, affectation par formulaire. */
export function ScheduleGrid({
  ctx,
  versionId,
  editable,
  published,
  slots,
}: {
  ctx: Ctx;
  versionId: string;
  editable: boolean;
  published: boolean;
  slots: SlotView[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { message, apply } = useFeedback();
  const [assignFor, setAssignFor] = useState<SlotView | null>(null);
  const run = (fn: () => Promise<{ status: string; message?: string }>) =>
    start(async () => {
      apply(await fn());
      router.refresh();
    });
  return (
    <div className="space-y-3">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <ul className="m-0 list-none space-y-3 p-0">
        {slots.map((s) => (
          <li
            key={s.shiftId}
            className={`rounded-[9px] border p-3 ${s.missing > 0 ? "border-orange bg-[#fff6ec]" : "border-border"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="m-0 text-[14px] font-bold">
                  {s.positionName}
                  {s.label ? ` · ${s.label}` : ""}
                  <span className="ml-2 text-[11px] font-normal text-muted">{s.teamName}</span>
                </p>
                <p className="m-0 text-[12px] text-muted">{s.rangeLabel}</p>
              </div>
              <Badge tone={s.missing > 0 ? "orange" : "lime"} noDot>
                {s.assignments.length} / {s.requiredCount} requis
                {s.maxCount > s.requiredCount ? ` (max ${s.maxCount})` : ""}
                {s.missing > 0 ? ` · ${s.missing} manquante(s)` : ""}
              </Badge>
            </div>
            <ul className="m-0 mt-2 list-none divide-y divide-border p-0 text-[13px]">
              {s.assignments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    <b>{a.volunteerName}</b>
                    {a.locked ? (
                      <span className="ml-1 text-[11px] text-muted" title="Verrouillée">
                        🔒
                      </span>
                    ) : null}
                    <span className="ml-2 text-[11px] text-muted">{a.source === "auto" ? "proposée" : "manuelle"}</span>
                    {published ? (
                      <Badge
                        tone={
                          a.confirmationStatus === "confirmed"
                            ? "lime"
                            : a.confirmationStatus === "declined"
                              ? "error"
                              : "neutral"
                        }
                        noDot
                        className="ml-2"
                      >
                        {a.confirmationStatus === "confirmed"
                          ? "Confirmée"
                          : a.confirmationStatus === "declined"
                            ? "Indisponibilité signalée"
                            : "À confirmer"}
                      </Badge>
                    ) : null}
                    {a.conflict ? (
                      <Badge tone="error" noDot className="ml-2">
                        Conflit : {a.conflict}
                      </Badge>
                    ) : null}
                    {a.attendance ? (
                      <Badge tone="lavender" noDot className="ml-2">
                        {{ present: "Présent·e", absent: "Absent·e", late: "En retard", excused: "Excusé·e" }[
                          a.attendance.status
                        ] ?? a.attendance.status}
                      </Badge>
                    ) : null}
                  </span>
                  {editable && ctx.canSchedule ? (
                    <span className="flex gap-1">
                      <Button
                        variant="ghost"
                        className="min-h-9 text-[12px]"
                        loading={pending}
                        loadingLabel="…"
                        onClick={() =>
                          run(() => lockAction(ctx.organizationId, ctx.slug, ctx.eventSlug, versionId, a.id, !a.locked))
                        }
                      >
                        {a.locked ? "Déverrouiller" : "Verrouiller"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-9 text-[12px]"
                        loading={pending}
                        loadingLabel="…"
                        onClick={() =>
                          run(() => unassignAction(ctx.organizationId, ctx.slug, ctx.eventSlug, versionId, a.id))
                        }
                      >
                        Retirer
                      </Button>
                    </span>
                  ) : published && ctx.canSchedule ? (
                    <span className="flex gap-1">
                      {(["present", "late", "absent"] as const).map((st) => (
                        <Button
                          key={st}
                          variant="ghost"
                          className="min-h-9 text-[12px]"
                          loading={pending}
                          loadingLabel="…"
                          onClick={() =>
                            run(() => attendanceAction(ctx.organizationId, ctx.slug, ctx.eventSlug, a.id, st))
                          }
                        >
                          {{ present: "Présent·e", late: "Retard", absent: "Absent·e" }[st]}
                        </Button>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {editable && ctx.canSchedule && s.assignments.length < s.maxCount ? (
              <Button variant="secondary" className="mt-2 min-h-9 text-[12px]" onClick={() => setAssignFor(s)}>
                + Affecter…
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Dialog
        open={assignFor !== null}
        onOpenChange={(o) => {
          if (!o) setAssignFor(null);
        }}
      >
        <DialogTrigger asChild>
          <span className="hidden" />
        </DialogTrigger>
        <DialogPanel
          title={
            assignFor
              ? `Affecter sur ${assignFor.positionName}${assignFor.label ? ` · ${assignFor.label}` : ""}`
              : "Affecter"
          }
          description={assignFor?.rangeLabel}
        >
          {assignFor ? (
            <AssignForm
              key={assignFor.shiftId}
              ctx={ctx}
              versionId={versionId}
              slot={assignFor}
              onDone={(text) => {
                setAssignFor(null);
                apply({ status: "success", message: text });
              }}
            />
          ) : null}
        </DialogPanel>
      </Dialog>
    </div>
  );
}

/** Écran 16 — validation humaine et publication. */
export function PublishPanel({
  ctx,
  versionId,
  versionLabel,
  versionToken,
  status,
  blockers,
  unfilledCount,
  openRequests,
}: {
  ctx: Ctx;
  versionId: string;
  versionLabel: string;
  versionToken: number;
  status: string;
  blockers: string[];
  unfilledCount: number;
  openRequests: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { message, apply } = useFeedback();
  const [ack, setAck] = useState(false);
  const [notes, setNotes] = useState("");
  if (status === "published")
    return (
      <div className="space-y-2">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        <p className="text-[13px]">Cette version fait foi. Toute modification passe par une version de travail.</p>
      </div>
    );
  if (status === "superseded") return <p className="text-[13px] text-muted">Version remplacée : lecture seule.</p>;
  const blocked = blockers.length > 0 || (unfilledCount > 0 && !ack);
  return (
    <div className="space-y-3">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {blockers.length > 0 ? (
        <ul className="m-0 list-disc pl-5 text-[12px] text-error-text">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {openRequests > 0 ? (
        <p className="text-[12px] text-muted">
          {openRequests} demande(s) d'arbitrage ouverte(s) sur la version publiée : traitez-les ou remplacez les
          personnes ici.
        </p>
      ) : null}
      {unfilledCount > 0 ? (
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-1 size-4 accent-ink"
          />
          <span>
            Je publie en connaissance de cause avec <b>{unfilledCount} affectation(s) requise(s) non pourvue(s)</b>.
            Décision assumée, tracée dans l'audit.
          </span>
        </label>
      ) : null}
      {ctx.canSchedule && status !== "under_review" && blockers.length === 0 ? (
        <Button
          variant="secondary"
          loading={pending}
          loadingLabel="…"
          onClick={() =>
            start(async () => {
              apply(await reviewAction(ctx.organizationId, ctx.slug, ctx.eventSlug, versionId));
              router.refresh();
            })
          }
        >
          Passer en arbitrage
        </Button>
      ) : null}
      {ctx.canPublish ? (
        <ConfirmDialog
          trigger={
            <Button
              variant="primary"
              disabled={blocked}
              disabledReason={blockers[0] ?? "Confirmez d'abord la publication avec des besoins non pourvus."}
            >
              Publier le planning {versionLabel}
            </Button>
          }
          title={`Publier le planning ${versionLabel} ?`}
          description="Les contraintes sont revérifiées sur les données actuelles. Chaque bénévole reçoit uniquement ses missions modifiées ; la version précédente est remplacée. Cette version devient immuable."
          confirmLabel={`Publier ${versionLabel}`}
          pending={pending}
          onConfirm={() =>
            new Promise<void>((resolve) => {
              start(async () => {
                apply(
                  await publishAction(ctx.organizationId, ctx.slug, ctx.eventSlug, versionId, versionToken, ack, notes),
                );
                router.refresh();
                resolve();
              });
            })
          }
        >
          <FormField label="Note de version (facultatif)">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Ce qui change…"
            />
          </FormField>
        </ConfirmDialog>
      ) : (
        <p className="text-[12px] text-muted">
          La publication est réservée aux personnes habilitées (schedules.publish).
        </p>
      )}
    </div>
  );
}

export function RequestsPanel({
  ctx,
  requests,
}: {
  ctx: Ctx;
  requests: Array<{
    id: string;
    volunteerName: string;
    positionName: string;
    label: string | null;
    rangeLabel: string;
    message: string | null;
    createdLabel: string;
  }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { message, apply } = useFeedback();
  const [resolution, setResolution] = useState("");
  if (requests.length === 0) return <p className="text-[13px] text-muted">Aucune demande d'arbitrage en attente.</p>;
  return (
    <div className="space-y-2">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
        {requests.map((r) => (
          <li key={r.id} className="py-2">
            <b>{r.volunteerName}</b> signale une indisponibilité sur{" "}
            <b>
              {r.positionName}
              {r.label ? ` · ${r.label}` : ""}
            </b>{" "}
            ({r.rangeLabel}).
            {r.message ? <span className="block text-muted">« {r.message} »</span> : null}
            <span className="block text-[11px] text-muted">{r.createdLabel}</span>
            {ctx.canSchedule ? (
              <div className="mt-1 flex flex-wrap gap-2">
                <ConfirmDialog
                  trigger={
                    <Button variant="secondary" className="min-h-9 text-[12px]">
                      Traitée (remplacement fait)
                    </Button>
                  }
                  title="Marquer cette demande comme traitée ?"
                  description="À utiliser une fois la personne remplacée dans une nouvelle version publiée."
                  confirmLabel="Traitée"
                  pending={pending}
                  onConfirm={() =>
                    new Promise<void>((resolve) => {
                      start(async () => {
                        apply(
                          await resolveRequestAction(
                            ctx.organizationId,
                            ctx.slug,
                            ctx.eventSlug,
                            r.id,
                            "resolved",
                            resolution || "Remplacement effectué",
                          ),
                        );
                        setResolution("");
                        router.refresh();
                        resolve();
                      });
                    })
                  }
                >
                  <FormField label="Commentaire">
                    <Input value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={1000} />
                  </FormField>
                </ConfirmDialog>
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" className="min-h-9 text-[12px]">
                      Écarter (reste sur la mission)
                    </Button>
                  }
                  title="Écarter cette demande ?"
                  description="La personne reste affectée ; sa mission repasse « à confirmer »."
                  confirmLabel="Écarter"
                  destructive
                  pending={pending}
                  onConfirm={() =>
                    new Promise<void>((resolve) => {
                      start(async () => {
                        apply(
                          await resolveRequestAction(
                            ctx.organizationId,
                            ctx.slug,
                            ctx.eventSlug,
                            r.id,
                            "dismissed",
                            resolution || "Demande écartée",
                          ),
                        );
                        setResolution("");
                        router.refresh();
                        resolve();
                      });
                    })
                  }
                >
                  <FormField label="Commentaire">
                    <Input value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={1000} />
                  </FormField>
                </ConfirmDialog>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
