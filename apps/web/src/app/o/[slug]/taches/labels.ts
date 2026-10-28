/** Client-safe copies of the task labels (client components must not import @kroov/domain runtime). */
export const TASK_STATUS_LABELS = { todo: "À faire", doing: "En cours", done: "Terminée" } as const;
export const TASK_PRIORITY_LABELS = { low: "Basse", normal: "Normale", high: "Haute" } as const;
export type TaskStatus = keyof typeof TASK_STATUS_LABELS;
export type TaskPriority = keyof typeof TASK_PRIORITY_LABELS;

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  overdue: boolean;
  assignee: { memberId: string; name: string } | null;
  event: { id: string; title: string; slug: string } | null;
  source: "manual" | "system";
  version: number;
}
