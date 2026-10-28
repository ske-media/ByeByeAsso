"use server";

import { markRead, setPreferences } from "@kroov/domain/notifications";
import { createTask, deleteTask, updateTask } from "@kroov/domain/tasks";
import { revalidatePath } from "next/cache";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";

const tasksPath = (slug: string) => `/o/${slug}/taches`;

function taskPayload(values: Record<string, string>) {
  return {
    title: values.title ?? "",
    description: values.description || null,
    priority: values.priority || "normal",
    status: values.status || "todo",
    dueAt: values.dueAt || null,
    assigneeMemberId: values.assigneeMemberId || null,
    eventId: values.eventId || null,
  };
}

function revalidateTaskPages(slug: string, eventSlug?: string | null) {
  revalidatePath(tasksPath(slug));
  revalidatePath(`/o/${slug}`);
  if (eventSlug) revalidatePath(`/o/${slug}/evenements/${eventSlug}`);
}

export async function createTaskAction(
  organizationId: string,
  slug: string,
  eventSlug: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    await createTask(db(), await currentActor(), organizationId, taskPayload(values));
    revalidateTaskPages(slug, eventSlug);
    return { status: "success", message: "Tâche créée." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function updateTaskAction(
  organizationId: string,
  slug: string,
  taskId: string,
  version: number,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const t = await updateTask(db(), await currentActor(), organizationId, taskId, { ...taskPayload(values), version });
    revalidateTaskPages(slug, t.event?.slug ?? null);
    return { status: "success", message: "Tâche mise à jour." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function setTaskStatusAction(
  organizationId: string,
  slug: string,
  taskId: string,
  status: "todo" | "doing" | "done",
  version: number,
): Promise<ActionState> {
  try {
    const t = await updateTask(db(), await currentActor(), organizationId, taskId, { status, version });
    revalidateTaskPages(slug, t.event?.slug ?? null);
    return { status: "success", message: status === "done" ? "Tâche terminée." : "Tâche rouverte." };
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteTaskAction(organizationId: string, slug: string, taskId: string): Promise<ActionState> {
  try {
    await deleteTask(db(), await currentActor(), organizationId, taskId);
    revalidateTaskPages(slug);
    return { status: "success", message: "Tâche supprimée." };
  } catch (error) {
    return actionError(error);
  }
}

export async function markNotificationsReadAction(
  organizationId: string,
  slug: string,
  input: { all: true } | { ids: string[] },
): Promise<ActionState> {
  try {
    const r = await markRead(db(), await currentActor(), organizationId, input);
    revalidatePath(`/o/${slug}/notifications`);
    revalidatePath(`/o/${slug}`, "layout");
    return {
      status: "success",
      message: r.updated > 0 ? `${r.updated} notification(s) marquée(s) comme lue(s).` : "Rien à marquer.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function setNotificationPreferencesAction(
  organizationId: string,
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  const kinds = (values.kinds ?? "").split(",").filter(Boolean);
  try {
    await setPreferences(db(), await currentActor(), organizationId, {
      preferences: kinds.map((kind) => ({ kind, inApp: formData.get(`pref:${kind}`) === "on" })),
    });
    revalidatePath(`/o/${slug}/notifications`);
    return { status: "success", message: "Préférences enregistrées." };
  } catch (error) {
    return actionError(error, values);
  }
}
