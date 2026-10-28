import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, desc, eq, lt, ne, type SQL, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { loadMemberContext, requirePermission } from "../authorization";
import { csvEscape } from "../crm/identities";
import { type Actor, ConflictError, NotFoundError, UnauthenticatedError, ValidationError } from "../kernel";
import {
  type ListTasksInput,
  listTasksSchema,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
  type TaskUpdateInput,
  taskInputSchema,
  taskUpdateSchema,
} from "./schemas";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "À faire",
  doing: "En cours",
  done: "Terminée",
};
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
};

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  overdue: boolean;
  assignee: { memberId: string; userId: string; name: string } | null;
  event: { id: string; title: string; slug: string } | null;
  source: "manual" | "system";
  sourceKey: string | null;
  completedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskList {
  items: TaskView[];
  total: number;
  page: number;
  pageSize: number;
  /** Member id of the caller (for the « mes tâches » filter in the UI). */
  myMemberId: string | null;
  counts: { open: number; overdue: number; mine: number };
}

type TaskRow = typeof schema.tasks.$inferSelect;

function first<T>(rows: T[], what: string): T {
  const r = rows[0];
  if (r === undefined) throw new Error(`${what}: insert returned no row`);
  return r;
}

async function hydrate(db: DbExecutor, rows: TaskRow[], now: Date): Promise<TaskView[]> {
  const memberIds = [...new Set(rows.map((r) => r.assigneeMemberId).filter((v): v is string => v !== null))];
  const eventIds = [...new Set(rows.map((r) => r.eventId).filter((v): v is string => v !== null))];
  const members = new Map<string, { userId: string; name: string }>();
  if (memberIds.length > 0) {
    const ms = await db
      .select({ id: schema.organizationMembers.id, userId: schema.users.id, name: schema.users.name })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(
        sql`${schema.organizationMembers.id} in (${sql.join(
          memberIds.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    for (const m of ms) members.set(m.id, { userId: m.userId, name: m.name });
  }
  const events = new Map<string, { title: string; slug: string }>();
  if (eventIds.length > 0) {
    const es = await db
      .select({ id: schema.events.id, title: schema.events.title, slug: schema.events.slug })
      .from(schema.events)
      .where(
        sql`${schema.events.id} in (${sql.join(
          eventIds.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    for (const e of es) events.set(e.id, { title: e.title, slug: e.slug });
  }
  return rows.map((r) => {
    const m = r.assigneeMemberId ? members.get(r.assigneeMemberId) : undefined;
    const e = r.eventId ? events.get(r.eventId) : undefined;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      dueAt: r.dueAt,
      overdue: r.status !== "done" && r.dueAt !== null && r.dueAt < now,
      assignee: m && r.assigneeMemberId ? { memberId: r.assigneeMemberId, userId: m.userId, name: m.name } : null,
      event: e && r.eventId ? { id: r.eventId, title: e.title, slug: e.slug } : null,
      source: r.source,
      sourceKey: r.sourceKey,
      completedAt: r.completedAt,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

async function readContext(db: DbExecutor, actor: Actor, organizationId: string) {
  // Reading tasks requires organization.read (any member of the organization).
  const ctx = await requirePermission(db, actor, "organization.read", { organizationId });
  return ctx;
}

async function memberIdOf(db: DbExecutor, actor: Actor, organizationId: string): Promise<string | null> {
  if (actor.kind !== "user") return null;
  const ctx = await loadMemberContext(db, actor.userId, organizationId);
  return ctx?.memberId ?? null;
}

/* ------------------------------------------------------------------------- */
/* read                                                                       */
/* ------------------------------------------------------------------------- */

export async function listTasks(
  db: Database,
  actor: Actor,
  organizationId: string,
  rawInput: ListTasksInput = {},
  now = new Date(),
): Promise<TaskList> {
  const ctx = await readContext(db, actor, organizationId);
  const parsed = listTasksSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
  const f = parsed.data;
  const myMemberId = ctx?.memberId ?? null;

  const conds: SQL[] = [eq(schema.tasks.organizationId, organizationId)];
  if (f.status === "open") conds.push(ne(schema.tasks.status, "done"));
  else if (f.status !== "all") conds.push(eq(schema.tasks.status, f.status));
  if (f.mine) {
    if (!myMemberId)
      return {
        items: [],
        total: 0,
        page: f.page,
        pageSize: f.pageSize,
        myMemberId,
        counts: { open: 0, overdue: 0, mine: 0 },
      };
    conds.push(eq(schema.tasks.assigneeMemberId, myMemberId));
  }
  if (f.eventId) conds.push(eq(schema.tasks.eventId, f.eventId));
  if (f.overdue) conds.push(ne(schema.tasks.status, "done"), lt(schema.tasks.dueAt, now));
  const where = and(...conds);

  const [rows, totalRow, countRow] = await Promise.all([
    db
      .select()
      .from(schema.tasks)
      .where(where)
      .orderBy(
        sql`case ${schema.tasks.status} when 'doing' then 0 when 'todo' then 1 else 2 end`,
        sql`${schema.tasks.dueAt} asc nulls last`,
        sql`case ${schema.tasks.priority} when 'high' then 0 when 'normal' then 1 else 2 end`,
        desc(schema.tasks.createdAt),
      )
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.tasks).where(where),
    db
      .select({
        open: sql<number>`count(*) filter (where ${schema.tasks.status} <> 'done')::int`,
        overdue: sql<number>`count(*) filter (where ${schema.tasks.status} <> 'done' and ${schema.tasks.dueAt} < ${now})::int`,
        mine: sql<number>`count(*) filter (where ${schema.tasks.status} <> 'done' and ${schema.tasks.assigneeMemberId} = ${myMemberId})::int`,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.organizationId, organizationId)),
  ]);
  const counts = countRow[0] ?? { open: 0, overdue: 0, mine: 0 };
  return {
    items: await hydrate(db, rows, now),
    total: totalRow[0]?.n ?? 0,
    page: f.page,
    pageSize: f.pageSize,
    myMemberId,
    counts: { open: counts.open, overdue: counts.overdue, mine: myMemberId ? counts.mine : 0 },
  };
}

async function loadTask(db: DbExecutor, organizationId: string, taskId: string): Promise<TaskRow> {
  const row = (
    await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.organizationId, organizationId), eq(schema.tasks.id, taskId)))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("task", taskId);
  return row;
}

export async function getTask(db: Database, actor: Actor, organizationId: string, taskId: string): Promise<TaskView> {
  await readContext(db, actor, organizationId);
  const row = await loadTask(db, organizationId, taskId);
  return first(await hydrate(db, [row], new Date()), "task");
}

/* ------------------------------------------------------------------------- */
/* write                                                                      */
/* ------------------------------------------------------------------------- */

async function assertAssignee(db: DbExecutor, organizationId: string, memberId: string | null | undefined) {
  if (!memberId) return;
  const m = (
    await db
      .select({ id: schema.organizationMembers.id })
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, organizationId),
          eq(schema.organizationMembers.id, memberId),
          eq(schema.organizationMembers.status, "active"),
        ),
      )
      .limit(1)
  )[0];
  if (!m) throw new NotFoundError("organization_member", memberId);
}

async function assertEvent(db: DbExecutor, organizationId: string, eventId: string | null | undefined) {
  if (!eventId) return;
  const e = (
    await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(and(eq(schema.events.organizationId, organizationId), eq(schema.events.id, eventId)))
      .limit(1)
  )[0];
  if (!e) throw new NotFoundError("event", eventId);
}

export async function createTask(
  db: Database,
  actor: Actor,
  organizationId: string,
  rawInput: TaskInput | Record<string, unknown>,
): Promise<TaskView> {
  await requirePermission(db, actor, "tasks.manage", { organizationId });
  if (actor.kind !== "user") throw new UnauthenticatedError();
  const parsed = taskInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  return db.transaction(async (tx) => {
    await assertAssignee(tx, organizationId, v.assigneeMemberId);
    await assertEvent(tx, organizationId, v.eventId);
    const row = first(
      await tx
        .insert(schema.tasks)
        .values({
          organizationId,
          title: v.title,
          description: v.description,
          priority: v.priority,
          status: v.status,
          dueAt: v.dueAt,
          assigneeMemberId: v.assigneeMemberId ?? null,
          eventId: v.eventId ?? null,
          source: "manual",
          createdBy: actor.userId,
        })
        .returning(),
      "task",
    );
    await recordAudit(tx, actor, {
      organizationId,
      action: "task.created",
      targetType: "task",
      targetId: row.id,
      metadata: { title: row.title, eventId: row.eventId, assigneeMemberId: row.assigneeMemberId },
    });
    return first(await hydrate(tx, [row], new Date()), "task");
  });
}

/**
 * System tasks (created by the outbox consumer): idempotent on `(organizationId, sourceKey)`.
 * Returns the existing task when the key is already present, never a duplicate.
 */
export async function ensureSystemTask(
  db: DbExecutor,
  organizationId: string,
  input: {
    sourceKey: string;
    title: string;
    description?: string | null;
    priority?: TaskPriority;
    dueAt?: Date | null;
    eventId?: string | null;
  },
): Promise<{ task: TaskRow; created: boolean }> {
  const inserted = await db
    .insert(schema.tasks)
    .values({
      organizationId,
      title: input.title.slice(0, 200),
      description: input.description ?? null,
      priority: input.priority ?? "normal",
      dueAt: input.dueAt ?? null,
      eventId: input.eventId ?? null,
      source: "system",
      sourceKey: input.sourceKey,
    })
    .onConflictDoNothing({
      target: [schema.tasks.organizationId, schema.tasks.sourceKey],
      where: sql`${schema.tasks.sourceKey} is not null`,
    })
    .returning();
  const created = inserted[0];
  if (created) {
    await recordAudit(
      db,
      { kind: "system", job: "domain.events" },
      {
        organizationId,
        action: "task.created",
        targetType: "task",
        targetId: created.id,
        metadata: { title: created.title, source: "system", sourceKey: input.sourceKey },
      },
    );
    return { task: created, created: true };
  }
  const existing = (
    await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.organizationId, organizationId), eq(schema.tasks.sourceKey, input.sourceKey)))
      .limit(1)
  )[0];
  if (!existing) throw new Error("system task: conflict without existing row");
  return { task: existing, created: false };
}

export async function updateTask(
  db: Database,
  actor: Actor,
  organizationId: string,
  taskId: string,
  rawInput: TaskUpdateInput | Record<string, unknown>,
): Promise<TaskView> {
  await requirePermission(db, actor, "tasks.manage", { organizationId });
  if (actor.kind !== "user") throw new UnauthenticatedError();
  const parsed = taskUpdateSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  return db.transaction(async (tx) => {
    const t = await loadTask(tx, organizationId, taskId);
    if (v.version !== undefined && v.version !== t.version)
      throw new ConflictError("La tâche a été modifiée entre-temps ; rechargez.", { code: "stale_version" });
    const patch: Partial<TaskRow> = { version: t.version + 1, updatedAt: new Date() };
    if (v.title !== undefined) patch.title = v.title;
    if (v.description !== undefined) patch.description = v.description;
    if (v.priority !== undefined) patch.priority = v.priority;
    if (v.dueAt !== undefined) patch.dueAt = v.dueAt instanceof Date ? v.dueAt : null;
    if (v.assigneeMemberId !== undefined) {
      const id = v.assigneeMemberId || null;
      await assertAssignee(tx, organizationId, id);
      patch.assigneeMemberId = id;
    }
    if (v.eventId !== undefined) {
      const id = v.eventId || null;
      await assertEvent(tx, organizationId, id);
      patch.eventId = id;
    }
    if (v.status !== undefined && v.status !== t.status) {
      patch.status = v.status;
      if (v.status === "done") {
        patch.completedAt = new Date();
        patch.completedBy = actor.userId;
      } else {
        patch.completedAt = null;
        patch.completedBy = null;
      }
    }
    const row = first(
      await tx
        .update(schema.tasks)
        .set(patch)
        .where(and(eq(schema.tasks.id, t.id), eq(schema.tasks.version, t.version)))
        .returning(),
      "task update",
    );
    await recordAudit(tx, actor, {
      organizationId,
      action: v.status && v.status !== t.status ? `task.${v.status}` : "task.updated",
      targetType: "task",
      targetId: row.id,
      metadata: { fields: Object.keys(v).filter((k) => k !== "version"), from: t.status, to: row.status },
    });
    return first(await hydrate(tx, [row], new Date()), "task");
  });
}

export function completeTask(db: Database, actor: Actor, organizationId: string, taskId: string, version?: number) {
  return updateTask(db, actor, organizationId, taskId, version ? { status: "done", version } : { status: "done" });
}

export function reopenTask(db: Database, actor: Actor, organizationId: string, taskId: string, version?: number) {
  return updateTask(db, actor, organizationId, taskId, version ? { status: "todo", version } : { status: "todo" });
}

export async function deleteTask(db: Database, actor: Actor, organizationId: string, taskId: string): Promise<void> {
  await requirePermission(db, actor, "tasks.manage", { organizationId });
  await db.transaction(async (tx) => {
    const t = await loadTask(tx, organizationId, taskId);
    await tx.delete(schema.tasks).where(eq(schema.tasks.id, t.id));
    await recordAudit(tx, actor, {
      organizationId,
      action: "task.deleted",
      targetType: "task",
      targetId: t.id,
      metadata: { title: t.title, source: t.source },
    });
  });
}

/* ------------------------------------------------------------------------- */
/* export                                                                     */
/* ------------------------------------------------------------------------- */

export async function exportTasksCsv(db: Database, actor: Actor, organizationId: string): Promise<string> {
  await readContext(db, actor, organizationId);
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.organizationId, organizationId))
    .orderBy(asc(schema.tasks.status), sql`${schema.tasks.dueAt} asc nulls last`, asc(schema.tasks.createdAt));
  const items = await hydrate(db, rows, new Date());
  await recordAudit(db, actor, {
    organizationId,
    action: "tasks.exported",
    targetType: "organization",
    targetId: organizationId,
    metadata: { count: items.length },
  });
  const header = [
    "titre",
    "statut",
    "priorite",
    "echeance",
    "responsable",
    "evenement",
    "source",
    "terminee_le",
    "creee_le",
  ];
  const lines = items.map((t) =>
    [
      t.title,
      TASK_STATUS_LABELS[t.status],
      TASK_PRIORITY_LABELS[t.priority],
      t.dueAt?.toISOString() ?? "",
      t.assignee?.name ?? "",
      t.event?.title ?? "",
      t.source,
      t.completedAt?.toISOString() ?? "",
      t.createdAt.toISOString(),
    ]
      .map(csvEscape)
      .join(";"),
  );
  return `﻿${[header.join(";"), ...lines].join("\r\n")}\r\n`;
}

/** Members eligible as assignees (active members of the organization). */
export async function listAssignableMembers(
  db: Database,
  actor: Actor,
  organizationId: string,
): Promise<Array<{ memberId: string; name: string; email: string }>> {
  await readContext(db, actor, organizationId);
  const rows = await db
    .select({ memberId: schema.organizationMembers.id, name: schema.users.name, email: schema.users.email })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(
      and(
        eq(schema.organizationMembers.organizationId, organizationId),
        eq(schema.organizationMembers.status, "active"),
      ),
    )
    .orderBy(asc(schema.users.name));
  return rows;
}

export { memberIdOf as currentMemberId };
