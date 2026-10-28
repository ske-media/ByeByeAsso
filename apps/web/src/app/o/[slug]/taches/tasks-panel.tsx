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
  EmptyState,
  FormField,
  Input,
  Select,
  Textarea,
} from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { createTaskAction, deleteTaskAction, setTaskStatusAction, updateTaskAction } from "@/actions/operations";
import { type ActionState, idleState } from "@/lib/action-state";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskRow } from "./labels";

export interface TaskCtx {
  organizationId: string;
  slug: string;
  canManage: boolean;
  members: Array<{ memberId: string; name: string }>;
  events: Array<{ id: string; title: string; slug: string }>;
  /** When set, the form pre-selects this event and the list hides the event column. */
  eventId?: string | null;
  eventSlug?: string | null;
}

const fmtDue = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function TaskForm({ ctx, task, onDone }: { ctx: TaskCtx; task?: TaskRow; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    task
      ? updateTaskAction.bind(null, ctx.organizationId, ctx.slug, task.id, task.version)
      : createTaskAction.bind(null, ctx.organizationId, ctx.slug, ctx.eventSlug ?? null),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const values = state.status === "error" ? (state.values ?? {}) : {};
  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onDone();
    }
  }, [state.status, router, onDone]);
  return (
    <form action={action} noValidate className="space-y-2">
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <FormField label="Titre" required error={errors.title}>
        <Input name="title" required maxLength={200} defaultValue={values.title ?? task?.title ?? ""} />
      </FormField>
      <FormField label="Description" error={errors.description}>
        <Textarea
          name="description"
          rows={3}
          maxLength={4000}
          defaultValue={values.description ?? task?.description ?? ""}
        />
      </FormField>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <FormField label="Priorité" error={errors.priority}>
          <Select name="priority" defaultValue={values.priority ?? task?.priority ?? "normal"}>
            {Object.entries(TASK_PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Statut" error={errors.status}>
          <Select name="status" defaultValue={values.status ?? task?.status ?? "todo"}>
            {Object.entries(TASK_STATUS_LABELS)
              .filter(([v]) => task || v !== "done")
              .map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField label="Échéance" error={errors.dueAt}>
          <Input name="dueAt" type="datetime-local" defaultValue={values.dueAt ?? toLocalInput(task?.dueAt ?? null)} />
        </FormField>
        <FormField label="Responsable" error={errors.assigneeMemberId}>
          <Select name="assigneeMemberId" defaultValue={values.assigneeMemberId ?? task?.assignee?.memberId ?? ""}>
            <option value="">— Personne —</option>
            {ctx.members.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Événement lié" error={errors.eventId}>
        <Select name="eventId" defaultValue={values.eventId ?? task?.event?.id ?? ctx.eventId ?? ""}>
          <option value="">— Aucun —</option>
          {ctx.events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="…">
          {task ? "Enregistrer" : "Créer la tâche"}
        </Button>
      </div>
    </form>
  );
}

export function NewTaskButton({ ctx, label = "+ Nouvelle tâche" }: { ctx: TaskCtx; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!ctx.canManage) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">{label}</Button>
      </DialogTrigger>
      <DialogPanel title="Nouvelle tâche" description="Une tâche d'organisation, visible par toute l'équipe.">
        <TaskForm ctx={ctx} onDone={() => setOpen(false)} />
      </DialogPanel>
    </Dialog>
  );
}

function TaskItem({ ctx, task }: { ctx: TaskCtx; task: TaskRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<ActionState>(idleState);
  const [pending, start] = useTransition();
  const setStatus = (status: "todo" | "doing" | "done") =>
    start(async () => {
      const r = await setTaskStatusAction(ctx.organizationId, ctx.slug, task.id, status, task.version);
      setFeedback(r);
      if (r.status === "success") router.refresh();
    });
  const remove = () =>
    start(async () => {
      const r = await deleteTaskAction(ctx.organizationId, ctx.slug, task.id);
      setFeedback(r);
      setConfirmDelete(false);
      if (r.status === "success") router.refresh();
    });
  const done = task.status === "done";
  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
      {ctx.canManage ? (
        <button
          type="button"
          aria-label={done ? `Rouvrir : ${task.title}` : `Terminer : ${task.title}`}
          aria-pressed={done}
          disabled={pending}
          onClick={() => setStatus(done ? "todo" : "done")}
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-lime" : "border border-ink"}`}
        >
          {done ? "✓" : ""}
        </button>
      ) : (
        <span
          aria-hidden="true"
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-lime" : "border border-ink"}`}
        >
          {done ? "✓" : ""}
        </span>
      )}
      <div className="min-w-0 flex-1 text-[13px]">
        <span className={done ? "line-through text-muted" : "font-bold"}>{task.title}</span>
        {task.source === "system" ? (
          <Badge tone="lavender" noDot className="ml-2">
            Système
          </Badge>
        ) : null}
        {task.priority === "high" && !done ? (
          <Badge tone="pink" noDot className="ml-2">
            Priorité haute
          </Badge>
        ) : null}
        <span className="block text-muted">
          {task.dueAt ? (
            <span className={task.overdue ? "font-bold text-error-text" : ""}>
              {task.overdue ? "En retard · " : "Échéance "}
              {fmtDue(task.dueAt)}
            </span>
          ) : (
            "Sans échéance"
          )}
          {task.assignee ? ` · ${task.assignee.name}` : " · non attribuée"}
          {task.event && !ctx.eventId ? (
            <>
              {" · "}
              <Link href={`/o/${ctx.slug}/evenements/${task.event.slug}`}>{task.event.title}</Link>
            </>
          ) : null}
          {task.status === "doing" ? " · en cours" : ""}
        </span>
        {task.description ? (
          <span className="mt-1 block whitespace-pre-line text-muted">{task.description}</span>
        ) : null}
        {feedback.status === "error" && feedback.message ? (
          <span className="mt-1 block text-error-text">{feedback.message}</span>
        ) : null}
      </div>
      {ctx.canManage ? (
        <div className="flex shrink-0 items-center gap-1">
          {!done && task.status !== "doing" ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStatus("doing")}>
              Démarrer
            </Button>
          ) : null}
          <Dialog open={editing} onOpenChange={setEditing}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={`Modifier : ${task.title}`}>
                Modifier
              </Button>
            </DialogTrigger>
            <DialogPanel title="Modifier la tâche">
              <TaskForm ctx={ctx} task={task} onDone={() => setEditing(false)} />
            </DialogPanel>
          </Dialog>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Supprimer cette tâche ?"
            description={`« ${task.title} » sera supprimée définitivement (tracé dans l'audit).`}
            confirmLabel="Supprimer"
            destructive
            pending={pending}
            onConfirm={remove}
            trigger={
              <Button size="sm" variant="ghost" aria-label={`Supprimer : ${task.title}`}>
                Supprimer
              </Button>
            }
          />
        </div>
      ) : null}
    </li>
  );
}

export function TaskList({
  ctx,
  tasks,
  emptyTitle = "Aucune tâche",
}: {
  ctx: TaskCtx;
  tasks: TaskRow[];
  emptyTitle?: string;
}) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={
          ctx.canManage
            ? "Créez une tâche pour l'équipe : échéance, responsable, événement lié."
            : "Rien à afficher pour le moment."
        }
        action={<NewTaskButton ctx={ctx} label="Créer une tâche" />}
      />
    );
  }
  return (
    <ul className="m-0 list-none divide-y divide-border p-0">
      {tasks.map((t) => (
        <TaskItem key={t.id} ctx={ctx} task={t} />
      ))}
    </ul>
  );
}
