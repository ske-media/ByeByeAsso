import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { users } from "./auth";
import { events } from "./events";
import { volunteerApplications, volunteerShifts } from "./volunteers";

/**
 * SCHEDULING domain (phase 6). A schedule is versioned per event; the engine writes DRAFT
 * candidates, a human publishes. Invariants in the database:
 * - one published version per event (partial unique index);
 * - one assignment per (version, shift, application);
 * - runs and their input snapshots are append-only;
 * - every child row carries organization_id and is bound by composite FKs.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const scheduleVersionStatus = pgEnum("schedule_version_status", [
  "draft",
  "generating",
  "generation_failed",
  "proposed",
  "under_review",
  "published",
  "superseded",
]);
export const scheduleRunStatus = pgEnum("schedule_run_status", ["running", "succeeded", "failed"]);
export const assignmentSource = pgEnum("assignment_source", ["auto", "manual"]);
export const assignmentConfirmation = pgEnum("assignment_confirmation", ["pending", "confirmed", "declined"]);
export const assignmentRequestKind = pgEnum("assignment_request_kind", ["unavailable", "replacement"]);
export const assignmentRequestStatus = pgEnum("assignment_request_status", ["open", "resolved", "dismissed"]);
export const attendanceStatus = pgEnum("attendance_status", ["present", "absent", "late", "excused"]);

export const scheduleVersions = pgTable(
  "schedule_versions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    /** 1, 2, 3… rendered as V1, V2, V3. */
    number: integer("number").notNull(),
    status: scheduleVersionStatus("status").notNull().default("draft"),
    basedOnVersionId: uuid("based_on_version_id"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: ts("published_at"),
    supersededAt: ts("superseded_at"),
    /** Set when the publisher accepted to publish with unfilled required positions. */
    unfilledAcknowledged: boolean("unfilled_acknowledged").notNull().default(false),
    /** Optimistic concurrency token (every write to the version or its assignments bumps it). */
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("schedule_versions_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("schedule_versions_event_number_uq").on(t.eventId, t.number),
    uniqueIndex("schedule_versions_published_uq").on(t.eventId).where(sql`${t.status} = 'published'`),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "schedule_versions_event_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.basedOnVersionId],
      foreignColumns: [t.organizationId, t.id],
      name: "schedule_versions_based_on_fk",
    }).onDelete("set null"),
    check("schedule_versions_number_pos", sql`${t.number} >= 1`),
    check("schedule_versions_version_pos", sql`${t.version} >= 1`),
    check(
      "schedule_versions_published_fields",
      sql`${t.status} not in ('published', 'superseded') or ${t.publishedAt} is not null`,
    ),
  ],
);

export const scheduleGenerationRuns = pgTable(
  "schedule_generation_runs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    versionId: uuid("version_id").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    /** Immutable input snapshot (shifts, volunteers, rules, locks, weights) the run was computed from. */
    inputSnapshot: jsonb("input_snapshot").notNull(),
    inputHash: text("input_hash").notNull(),
    weights: jsonb("weights").notNull(),
    /** Partial regeneration scope (shift ids), null = whole event. */
    scope: jsonb("scope"),
    status: scheduleRunStatus("status").notNull().default("running"),
    coveredCount: integer("covered_count"),
    unfilledCount: integer("unfilled_count"),
    diagnostics: jsonb("diagnostics"),
    score: jsonb("score"),
    solverStatus: text("solver_status"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [scheduleVersions.organizationId, scheduleVersions.id],
      name: "schedule_generation_runs_version_fk",
    }).onDelete("cascade"),
    index("schedule_generation_runs_event_idx").on(t.eventId, t.startedAt),
    check("schedule_generation_runs_hash", sql`char_length(${t.inputHash}) = 64`),
  ],
);

export const volunteerAssignments = pgTable(
  "volunteer_assignments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    versionId: uuid("version_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    source: assignmentSource("source").notNull().default("auto"),
    locked: boolean("locked").notNull().default(false),
    confirmationStatus: assignmentConfirmation("confirmation_status").notNull().default("pending"),
    confirmedAt: ts("confirmed_at"),
    declinedAt: ts("declined_at"),
    notifiedAt: ts("notified_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    unique("volunteer_assignments_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("volunteer_assignments_uq").on(t.versionId, t.shiftId, t.applicationId),
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [scheduleVersions.organizationId, scheduleVersions.id],
      name: "volunteer_assignments_version_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.shiftId],
      foreignColumns: [volunteerShifts.organizationId, volunteerShifts.id],
      name: "volunteer_assignments_shift_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.applicationId],
      foreignColumns: [volunteerApplications.organizationId, volunteerApplications.id],
      name: "volunteer_assignments_application_fk",
    }).onDelete("cascade"),
    index("volunteer_assignments_application_idx").on(t.applicationId),
    index("volunteer_assignments_shift_idx").on(t.shiftId),
  ],
);

export const volunteerAssignmentRequests = pgTable(
  "volunteer_assignment_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    kind: assignmentRequestKind("kind").notNull().default("unavailable"),
    message: text("message"),
    status: assignmentRequestStatus("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.assignmentId],
      foreignColumns: [volunteerAssignments.organizationId, volunteerAssignments.id],
      name: "volunteer_assignment_requests_assignment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.applicationId],
      foreignColumns: [volunteerApplications.organizationId, volunteerApplications.id],
      name: "volunteer_assignment_requests_application_fk",
    }).onDelete("cascade"),
    uniqueIndex("volunteer_assignment_requests_open_uq").on(t.assignmentId).where(sql`${t.status} = 'open'`),
    index("volunteer_assignment_requests_event_idx").on(t.eventId, t.status),
  ],
);

export const volunteerAttendance = pgTable(
  "volunteer_attendance",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    status: attendanceStatus("status").notNull(),
    checkedInAt: ts("checked_in_at"),
    checkedOutAt: ts("checked_out_at"),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.assignmentId],
      foreignColumns: [volunteerAssignments.organizationId, volunteerAssignments.id],
      name: "volunteer_attendance_assignment_fk",
    }).onDelete("cascade"),
    uniqueIndex("volunteer_attendance_assignment_uq").on(t.assignmentId),
    index("volunteer_attendance_event_idx").on(t.eventId),
    check(
      "volunteer_attendance_times",
      sql`${t.checkedOutAt} is null or ${t.checkedInAt} is null or ${t.checkedOutAt} >= ${t.checkedInAt}`,
    ),
  ],
);

/**
 * Effective commitments = assignments of the PUBLISHED version of each event, not declined.
 * Draft candidates never appear here; this is what "no overlapping published commitments" is checked on.
 */
export const activeVolunteerCommitments = pgView("active_volunteer_commitments").as((qb) =>
  qb
    .select({
      assignmentId: volunteerAssignments.id,
      organizationId: volunteerAssignments.organizationId,
      eventId: volunteerAssignments.eventId,
      versionId: volunteerAssignments.versionId,
      shiftId: volunteerAssignments.shiftId,
      applicationId: volunteerAssignments.applicationId,
      confirmationStatus: volunteerAssignments.confirmationStatus,
      startsAt: volunteerShifts.startsAt,
      endsAt: volunteerShifts.endsAt,
      email: volunteerApplications.email,
    })
    .from(volunteerAssignments)
    .innerJoin(scheduleVersions, sql`${scheduleVersions.id} = ${volunteerAssignments.versionId}`)
    .innerJoin(volunteerShifts, sql`${volunteerShifts.id} = ${volunteerAssignments.shiftId}`)
    .innerJoin(volunteerApplications, sql`${volunteerApplications.id} = ${volunteerAssignments.applicationId}`)
    .where(
      sql`${scheduleVersions.status} = 'published' and ${volunteerAssignments.confirmationStatus} <> 'declined' and ${volunteerShifts.status} = 'active'`,
    ),
);
