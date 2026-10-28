import "server-only";
import type { TaskView } from "@kroov/domain/tasks";
import type { TaskRow } from "@/app/o/[slug]/taches/labels";

/** Serialises a domain task for client components (dates as ISO strings). */
export function toTaskRow(t: TaskView): TaskRow {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt?.toISOString() ?? null,
    overdue: t.overdue,
    assignee: t.assignee ? { memberId: t.assignee.memberId, name: t.assignee.name } : null,
    event: t.event,
    source: t.source,
    version: t.version,
  };
}
