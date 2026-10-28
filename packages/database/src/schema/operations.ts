import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { users } from "./auth";
import { events } from "./events";
import { organizationMembers, organizations } from "./identity";

/**
 * OPERATIONS domain (phase 9): organization tasks and internal notifications.
 * No metrics tables — dashboards are computed from the authoritative records.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const taskStatus = pgEnum("task_status", ["todo", "doing", "done"]);
export const taskPriority = pgEnum("task_priority", ["low", "normal", "high"]);
export const taskSource = pgEnum("task_source", ["manual", "system"]);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatus("status").notNull().default("todo"),
    priority: taskPriority("priority").notNull().default("normal"),
    dueAt: ts("due_at"),
    assigneeMemberId: uuid("assignee_member_id"),
    eventId: uuid("event_id"),
    source: taskSource("source").notNull().default("manual"),
    /** Idempotency key for system-created tasks (e.g. "unavailability:<requestId>"). */
    sourceKey: text("source_key"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: ts("completed_at"),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("tasks_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("tasks_source_key_uq").on(t.organizationId, t.sourceKey).where(sql`${t.sourceKey} is not null`),
    index("tasks_org_status_idx").on(t.organizationId, t.status, t.dueAt),
    index("tasks_assignee_idx").on(t.assigneeMemberId),
    index("tasks_event_idx").on(t.eventId),
    foreignKey({
      columns: [t.organizationId, t.assigneeMemberId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.id],
      name: "tasks_assignee_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "tasks_event_fk",
    }).onDelete("set null"),
    check("tasks_title_length", sql`char_length(${t.title}) between 1 and 200`),
    check("tasks_done_completed", sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
    check("tasks_version_pos", sql`${t.version} >= 1`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    /** Idempotency of the outbox consumer: one notification per (member, event). */
    dedupeKey: text("dedupe_key").notNull(),
    readAt: ts("read_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uq").on(t.organizationId, t.userId, t.dedupeKey),
    index("notifications_user_unread_idx").on(t.userId, t.organizationId, t.createdAt).where(sql`${t.readAt} is null`),
    index("notifications_user_idx").on(t.userId, t.organizationId, t.createdAt),
    check("notifications_kind_format", sql`${t.kind} ~ '^[a-z_]+\\.[a-z_]+$'`),
    check("notifications_title_length", sql`char_length(${t.title}) between 1 and 200`),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("notification_preferences_uq").on(t.organizationId, t.userId, t.kind),
    check("notification_preferences_kind_format", sql`${t.kind} ~ '^[a-z_]+\\.[a-z_]+$'`),
  ],
);
