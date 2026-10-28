import { z } from "zod";

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** "" | null | undefined → null; text otherwise. */
const nullableText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v ? v : null));

/** "" | null | undefined → null; a uuid otherwise. */
const nullableUuid = z
  .union([z.string().uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

/** "" | null | undefined → null; a valid date otherwise. */
const nullableDate = z
  .union([z.coerce.date(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null));

/** Update variant: undefined stays undefined (field untouched), "" | null → null. */
const patchText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Le titre est obligatoire.").max(200),
  description: nullableText(4000),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  status: z.enum(["todo", "doing"]).default("todo"),
  dueAt: nullableDate,
  assigneeMemberId: nullableUuid,
  eventId: nullableUuid,
});
export type TaskInput = z.infer<typeof taskInputSchema>;

/** Explicit update schema: no defaults, so a PATCH never resets fields it does not mention. */
export const taskUpdateSchema = z.object({
  title: z.string().trim().min(1, "Le titre est obligatoire.").max(200).optional(),
  description: patchText(4000),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueAt: z.union([z.coerce.date(), z.literal(""), z.null()]).optional(),
  assigneeMemberId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  eventId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  version: z.coerce.number().int().min(1).optional(),
});
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export const listTasksSchema = z.object({
  status: z.enum([...TASK_STATUSES, "open", "all"]).default("open"),
  mine: z.coerce.boolean().default(false),
  eventId: z.string().uuid().optional(),
  overdue: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTasksInput = z.input<typeof listTasksSchema>;
