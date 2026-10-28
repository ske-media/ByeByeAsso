import { createHash } from "node:crypto";
import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { recordTouchpoint } from "../crm";
import { type Actor, ConflictError, NotFoundError, PreconditionFailedError } from "../kernel";
import { emitDomainEvent } from "../outbox";
import { deriveToken, hashToken, tokensEqual } from "../ticketing/context";
import { VOLUNTEER_TOKEN_SCOPE } from "../volunteers/applications";
import { effectiveAvailability } from "../volunteers/availability";
import { loadPositionsUnchecked, loadSkillsUnchecked } from "../volunteers/catalogue";
import type { VolunteerContext } from "../volunteers/emails";
import { loadEventPositionsUnchecked } from "../volunteers/staffing";
import { volunteerApplicationStateMachine } from "../volunteers/state-machine";
import { sendMissionsPublished, sendUnavailabilityReceived } from "./emails";
import {
  ALGORITHM_VERSION,
  DEFAULT_WEIGHTS,
  type EngineAssignment,
  type EngineInput,
  type EngineOutput,
  type EngineRules,
  type EngineShift,
  type EngineVolunteer,
  type EngineWeights,
  HARD_REASON_LABELS,
  type HardReason,
  hardViolation,
  runEngine,
  validateAssignments,
} from "./engine";
import {
  type AssignInput,
  type AttendanceInput,
  assignSchema,
  attendanceSchema,
  type CreateVersionInput,
  createVersionSchema,
  type GenerateInput,
  generateSchema,
  type PublishInput,
  publishSchema,
} from "./schemas";
import { EDITABLE_VERSION_STATUSES, type ScheduleVersionStatus, scheduleVersionStateMachine } from "./state-machine";

/* ------------------------------------------------------------------------- */
/* views                                                                      */
/* ------------------------------------------------------------------------- */

export interface VersionSummary {
  id: string;
  eventId: string;
  number: number;
  label: string;
  status: ScheduleVersionStatus;
  basedOnVersionId: string | null;
  notes: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  supersededAt: Date | null;
  unfilledAcknowledged: boolean;
  version: number;
  assignmentsCount: number;
  requiredTotal: number;
  coveredCount: number;
  lastRunStatus: "running" | "succeeded" | "failed" | null;
}

export interface AssignmentView {
  id: string;
  shiftId: string;
  applicationId: string;
  volunteerName: string;
  volunteerEmail: string;
  source: "auto" | "manual";
  locked: boolean;
  confirmationStatus: "pending" | "confirmed" | "declined";
  confirmedAt: Date | null;
  openRequest: { id: string; kind: "unavailable" | "replacement"; message: string | null; createdAt: Date } | null;
  attendance: { status: "present" | "absent" | "late" | "excused"; note: string | null } | null;
}

export interface ShiftSlotView {
  shiftId: string;
  eventPositionId: string;
  positionId: string;
  positionName: string;
  teamName: string;
  teamColor: string;
  label: string | null;
  startsAt: Date;
  endsAt: Date;
  requiredCount: number;
  maxCount: number;
  assignments: AssignmentView[];
  missing: number;
  /** Who could still take this shift now (hard constraints), and why the others cannot. */
  candidates: Array<{ applicationId: string; name: string; preferenceRank: number | null }>;
  excluded: Array<{ applicationId: string; name: string; reason: HardReason; label: string }>;
}

export interface ConflictView {
  assignmentId: string;
  shiftId: string;
  applicationId: string;
  volunteerName: string;
  positionName: string;
  reason: HardReason;
  label: string;
}

export interface VersionDetail extends VersionSummary {
  shifts: ShiftSlotView[];
  conflicts: ConflictView[];
  unfilled: Array<{
    shiftId: string;
    positionName: string;
    label: string | null;
    startsAt: Date;
    endsAt: Date;
    missing: number;
  }>;
  invalidLocks: Array<{ shiftId: string; applicationId: string; reason: HardReason; label: string }>;
  volunteers: Array<{ applicationId: string; name: string; status: string; hours: number; assignments: number }>;
  openRequests: number;
  lastRun: RunView | null;
  canPublish: boolean;
  publishBlockers: string[];
}

export interface RunView {
  id: string;
  versionId: string;
  algorithmVersion: string;
  inputHash: string;
  weights: EngineWeights;
  scope: string[] | null;
  status: "running" | "succeeded" | "failed";
  coveredCount: number | null;
  unfilledCount: number | null;
  requiredTotal: number | null;
  diagnostics: unknown;
  score: unknown;
  solverStatus: string | null;
  durationMs: number | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface DiffEntry {
  applicationId: string;
  volunteerName: string;
  shiftId: string;
  positionName: string;
  label: string | null;
  startsAt: Date;
  endsAt: Date;
  change: "added" | "removed";
}

/* ------------------------------------------------------------------------- */
/* input assembly                                                             */
/* ------------------------------------------------------------------------- */

interface Assembled {
  event: typeof schema.events.$inferSelect;
  shifts: EngineShift[];
  shiftMeta: Map<
    string,
    { eventPositionId: string; positionId: string; label: string | null; teamName: string; teamColor: string }
  >;
  volunteers: EngineVolunteer[];
  volunteerMeta: Map<string, { email: string; status: string; secretVersion: number }>;
  rules: EngineRules;
}

/** Current data for the engine and for validation: active shifts, approved/assigned/confirmed volunteers. */
async function assemble(db: DbExecutor, organizationId: string, eventId: string): Promise<Assembled> {
  const event = (
    await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.id, eventId), eq(schema.events.organizationId, organizationId)))
      .limit(1)
  )[0];
  if (!event) throw new NotFoundError("Événement", eventId);
  const [positions, templates, skills] = await Promise.all([
    loadEventPositionsUnchecked(db, organizationId, eventId),
    loadPositionsUnchecked(db, organizationId),
    loadSkillsUnchecked(db, organizationId),
  ]);
  const shifts: EngineShift[] = [];
  const shiftMeta: Assembled["shiftMeta"] = new Map();
  for (const p of positions) {
    if (p.status !== "active") continue;
    for (const s of p.shifts) {
      if (s.status !== "active") continue;
      shifts.push({
        id: s.id,
        positionId: p.positionId,
        positionName: p.name,
        start: s.startsAt.getTime(),
        end: s.endsAt.getTime(),
        required: s.requiredCount,
        max: s.maxCount,
        mandatorySkillIds: p.skills.filter((k) => k.mandatory).map((k) => k.skillId),
        optionalSkillIds: p.skills.filter((k) => !k.mandatory).map((k) => k.skillId),
        minAge: p.minAge,
      });
      shiftMeta.set(s.id, {
        eventPositionId: p.id,
        positionId: p.positionId,
        label: s.label,
        teamName: p.teamName,
        teamColor: p.teamColor,
      });
    }
  }
  void templates;
  const apps = await db
    .select()
    .from(schema.volunteerApplications)
    .where(
      and(
        eq(schema.volunteerApplications.eventId, eventId),
        inArray(schema.volunteerApplications.status, ["approved", "assigned", "confirmed"]),
      ),
    )
    .orderBy(asc(schema.volunteerApplications.lastName), asc(schema.volunteerApplications.firstName));
  const ids = apps.map((a) => a.id);
  const [avails, declared, prefs, social] =
    ids.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          db
            .select()
            .from(schema.volunteerAvailabilities)
            .where(inArray(schema.volunteerAvailabilities.applicationId, ids)),
          db.select().from(schema.volunteerSkills).where(inArray(schema.volunteerSkills.applicationId, ids)),
          db
            .select()
            .from(schema.volunteerPositionPreferences)
            .where(inArray(schema.volunteerPositionPreferences.applicationId, ids)),
          db
            .select()
            .from(schema.volunteerSocialPreferences)
            .where(
              and(
                inArray(schema.volunteerSocialPreferences.applicationId, ids),
                eq(schema.volunteerSocialPreferences.reciprocal, true),
              ),
            ),
        ]);
  const requiresVerification = new Map(skills.map((s) => [s.id, s.requiresVerification]));
  const byEmail = new Map(apps.map((a) => [a.email, a.id]));
  const volunteers: EngineVolunteer[] = apps.map((a) => ({
    id: a.id,
    name: `${a.firstName} ${a.lastName}`,
    availability: effectiveAvailability(avails.filter((r) => r.applicationId === a.id)),
    qualifiedSkillIds: declared
      .filter((d) => d.applicationId === a.id && (!requiresVerification.get(d.skillId) || d.verified))
      .map((d) => d.skillId),
    preferences: Object.fromEntries(prefs.filter((p) => p.applicationId === a.id).map((p) => [p.positionId, p.rank])),
    buddies: social
      .filter((s) => s.applicationId === a.id)
      .map((s) => byEmail.get(s.targetEmail))
      .filter((x): x is string => Boolean(x)),
    birthYear: a.birthYear,
  }));
  const volunteerMeta = new Map(
    apps.map((a) => [a.id, { email: a.email, status: a.status, secretVersion: a.secretVersion }]),
  );
  return {
    event,
    shifts,
    shiftMeta,
    volunteers,
    volunteerMeta,
    rules: {
      maxHoursPerDay: event.volunteerMaxHours,
      minRestMinutes: event.volunteerMinRestMinutes,
      timezone: event.timezone,
      eventYear: new Date(event.startsAt).getUTCFullYear(),
    },
  };
}

function snapshotOf(
  a: Assembled,
  locks: EngineAssignment[],
  fixed: EngineAssignment[],
  weights: EngineWeights,
  scope: string[] | undefined,
) {
  const snapshot = {
    algorithmVersion: ALGORITHM_VERSION,
    eventId: a.event.id,
    rules: a.rules,
    shifts: a.shifts,
    volunteers: a.volunteers,
    locks,
    fixed,
    scope: scope ?? null,
    weights,
  };
  const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return { snapshot, hash };
}

/* ------------------------------------------------------------------------- */
/* versions                                                                   */
/* ------------------------------------------------------------------------- */

type VersionRow = typeof schema.scheduleVersions.$inferSelect;

async function loadVersion(
  db: DbExecutor,
  organizationId: string,
  versionId: string,
  lock = false,
): Promise<VersionRow> {
  const q = db
    .select()
    .from(schema.scheduleVersions)
    .where(and(eq(schema.scheduleVersions.id, versionId), eq(schema.scheduleVersions.organizationId, organizationId)))
    .limit(1);
  const row = (lock ? await q.for("update") : await q)[0];
  if (!row) throw new NotFoundError("Version de planning", versionId);
  return row;
}

async function authorize(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
  permission: "volunteers.schedule" | "schedules.publish" | "volunteers.review" | "checkins.scan",
) {
  await requirePermission(db, actor, permission, { organizationId, eventId });
}

async function summaries(
  db: DbExecutor,
  organizationId: string,
  eventId: string,
  requiredTotal: number,
): Promise<VersionSummary[]> {
  const rows = await db
    .select({
      v: schema.scheduleVersions,
      assignments: sql<number>`(select count(*)::int from ${schema.volunteerAssignments} a where a.version_id = "schedule_versions"."id")`,
      covered: sql<number>`(select coalesce(sum(least(c.n, s.required_count)), 0)::int from (select a.shift_id, count(*) as n from ${schema.volunteerAssignments} a where a.version_id = "schedule_versions"."id" group by a.shift_id) c join ${schema.volunteerShifts} s on s.id = c.shift_id where s.status = 'active')`,
      lastRun: sql<
        string | null
      >`(select r.status::text from ${schema.scheduleGenerationRuns} r where r.version_id = "schedule_versions"."id" order by r.started_at desc limit 1)`,
    })
    .from(schema.scheduleVersions)
    .where(
      and(eq(schema.scheduleVersions.organizationId, organizationId), eq(schema.scheduleVersions.eventId, eventId)),
    )
    .orderBy(desc(schema.scheduleVersions.number));
  return rows.map((r) => ({
    id: r.v.id,
    eventId: r.v.eventId,
    number: r.v.number,
    label: `V${r.v.number}`,
    status: r.v.status,
    basedOnVersionId: r.v.basedOnVersionId,
    notes: r.v.notes,
    createdAt: r.v.createdAt,
    publishedAt: r.v.publishedAt,
    supersededAt: r.v.supersededAt,
    unfilledAcknowledged: r.v.unfilledAcknowledged,
    version: r.v.version,
    assignmentsCount: r.assignments,
    requiredTotal,
    coveredCount: r.covered,
    lastRunStatus: (r.lastRun as VersionSummary["lastRunStatus"]) ?? null,
  }));
}

export async function listVersions(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<VersionSummary[]> {
  await authorize(db, actor, organizationId, eventId, "volunteers.review");
  const a = await assemble(db, organizationId, eventId);
  return summaries(
    db,
    organizationId,
    eventId,
    a.shifts.reduce((n, s) => n + s.required, 0),
  );
}

export async function createVersion(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  input: CreateVersionInput = {},
): Promise<VersionSummary> {
  await authorize(db, actor, organizationId, eventId, "volunteers.schedule");
  const v = createVersionSchema.parse(input);
  const id = await db.transaction(async (tx) => {
    const event = (
      await tx
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(and(eq(schema.events.id, eventId), eq(schema.events.organizationId, organizationId)))
        .for("update")
    )[0];
    if (!event) throw new NotFoundError("Événement", eventId);
    const last = (
      await tx
        .select({ n: sql<number>`coalesce(max(${schema.scheduleVersions.number}), 0)::int` })
        .from(schema.scheduleVersions)
        .where(eq(schema.scheduleVersions.eventId, eventId))
    )[0];
    let basedOn: VersionRow | null = null;
    if (v.basedOnVersionId) {
      basedOn = await loadVersion(tx, organizationId, v.basedOnVersionId);
      if (basedOn.eventId !== eventId) throw new NotFoundError("Version de planning", v.basedOnVersionId);
    }
    const [row] = await tx
      .insert(schema.scheduleVersions)
      .values({
        organizationId,
        eventId,
        number: (last?.n ?? 0) + 1,
        basedOnVersionId: basedOn?.id ?? null,
        notes: v.notes ?? null,
        createdBy: actor.kind === "user" ? actor.userId : null,
      })
      .returning({ id: schema.scheduleVersions.id, number: schema.scheduleVersions.number });
    if (!row) throw new Error("insert failed");
    if (basedOn) {
      const source = await tx
        .select()
        .from(schema.volunteerAssignments)
        .where(eq(schema.volunteerAssignments.versionId, basedOn.id));
      if (source.length > 0)
        await tx.insert(schema.volunteerAssignments).values(
          source.map((s) => ({
            organizationId,
            eventId,
            versionId: row.id,
            shiftId: s.shiftId,
            applicationId: s.applicationId,
            source: s.source,
            locked: s.locked,
            createdBy: actor.kind === "user" ? actor.userId : null,
          })),
        );
    }
    await recordAudit(tx, actor, {
      organizationId,
      action: "schedule_version.created",
      targetType: "schedule_version",
      targetId: row.id,
      metadata: { eventId, number: row.number, basedOn: basedOn?.number ?? null },
    });
    return row.id;
  });
  const list = await listVersions(db, actor, organizationId, eventId);
  const created = list.find((x) => x.id === id);
  if (!created) throw new Error("reload failed");
  return created;
}

async function transitionVersion(
  tx: DbExecutor,
  actor: Actor,
  row: VersionRow,
  to: ScheduleVersionStatus,
  extra: Partial<typeof schema.scheduleVersions.$inferInsert> = {},
) {
  scheduleVersionStateMachine.transition(row.status, to, { actor: actor.kind });
  await tx
    .update(schema.scheduleVersions)
    .set({ status: to, version: row.version + 1, ...extra })
    .where(eq(schema.scheduleVersions.id, row.id));
  await recordAudit(tx, actor, {
    organizationId: row.organizationId,
    action: `schedule_version.${to}`,
    targetType: "schedule_version",
    targetId: row.id,
    metadata: { from: row.status, number: row.number },
  });
}

function assertEditable(row: VersionRow) {
  if (!EDITABLE_VERSION_STATUSES.includes(row.status))
    throw new PreconditionFailedError("Cette version n'est plus modifiable (publiée ou remplacée).", {
      code: "version_immutable",
      status: row.status,
    });
}

/* ------------------------------------------------------------------------- */
/* generation                                                                 */
/* ------------------------------------------------------------------------- */

export async function generateVersion(
  db: Database,
  actor: Actor,
  organizationId: string,
  versionId: string,
  input: GenerateInput = {},
): Promise<{ version: VersionSummary; run: RunView; output: EngineOutput }> {
  const v = generateSchema.parse(input);
  const head = await loadVersion(db, organizationId, versionId);
  await authorize(db, actor, organizationId, head.eventId, "volunteers.schedule");
  const weights: EngineWeights = { ...DEFAULT_WEIGHTS };
  for (const [k, val] of Object.entries(v.weights ?? {}))
    if (val !== undefined) weights[k as keyof EngineWeights] = val;
  // Mark generating + create the run with the immutable snapshot, in one transaction.
  const prepared = await db.transaction(async (tx) => {
    const row = await loadVersion(tx, organizationId, versionId, true);
    assertEditable(row);
    const a = await assemble(tx, organizationId, row.eventId);
    const existing = await tx
      .select()
      .from(schema.volunteerAssignments)
      .where(eq(schema.volunteerAssignments.versionId, row.id));
    const scope = v.shiftIds ? v.shiftIds.filter((id) => a.shifts.some((s) => s.id === id)) : undefined;
    const inScope = (shiftId: string) => !scope || scope.includes(shiftId);
    const locks = existing
      .filter((e) => e.locked && inScope(e.shiftId))
      .map((e) => ({ shiftId: e.shiftId, applicationId: e.applicationId }));
    const fixed = existing
      .filter((e) => !inScope(e.shiftId))
      .map((e) => ({ shiftId: e.shiftId, applicationId: e.applicationId }));
    const toEngine = (x: { shiftId: string; applicationId: string }) => ({
      shiftId: x.shiftId,
      volunteerId: x.applicationId,
    });
    const { snapshot, hash } = snapshotOf(a, locks.map(toEngine), fixed.map(toEngine), weights, scope);
    await transitionVersion(tx, actor, row, "generating");
    const [run] = await tx
      .insert(schema.scheduleGenerationRuns)
      .values({
        organizationId,
        eventId: row.eventId,
        versionId: row.id,
        algorithmVersion: ALGORITHM_VERSION,
        inputSnapshot: snapshot,
        inputHash: hash,
        weights,
        scope: scope ?? null,
        startedBy: actor.kind === "user" ? actor.userId : null,
      })
      .returning({ id: schema.scheduleGenerationRuns.id });
    if (!run) throw new Error("run insert failed");
    return { row, a, scope, locks: locks.map(toEngine), fixed: fixed.map(toEngine), runId: run.id };
  });
  // Run the engine (pure, bounded).
  let output: EngineOutput;
  try {
    const engineInput: EngineInput = {
      shifts: prepared.a.shifts,
      volunteers: prepared.a.volunteers,
      rules: prepared.a.rules,
      locks: prepared.locks,
      fixed: prepared.fixed,
      scope: prepared.scope,
      weights,
      limits: { maxMillis: 5_000, maxIterations: 50_000 },
    };
    output = runEngine(engineInput);
  } catch (error) {
    await db.transaction(async (tx) => {
      const row = await loadVersion(tx, organizationId, versionId, true);
      await tx
        .update(schema.scheduleGenerationRuns)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : "Erreur du moteur",
          finishedAt: new Date(),
        })
        .where(eq(schema.scheduleGenerationRuns.id, prepared.runId));
      await transitionVersion(tx, actor, row, "generation_failed");
    });
    throw error;
  }
  // Persist the draft.
  await db.transaction(async (tx) => {
    const row = await loadVersion(tx, organizationId, versionId, true);
    const inScope = (shiftId: string) => !prepared.scope || prepared.scope.includes(shiftId);
    // Replace unlocked in-scope assignments; keep locked (valid) and out-of-scope ones.
    const existing = await tx
      .select()
      .from(schema.volunteerAssignments)
      .where(eq(schema.volunteerAssignments.versionId, row.id));
    const keep = new Set(
      output.assignments.filter((x) => x.source !== "auto").map((x) => `${x.shiftId}|${x.volunteerId}`),
    );
    for (const e of existing) {
      if (!inScope(e.shiftId)) continue;
      if (e.locked && keep.has(`${e.shiftId}|${e.applicationId}`)) continue;
      await tx.delete(schema.volunteerAssignments).where(eq(schema.volunteerAssignments.id, e.id));
    }
    const autos = output.assignments.filter((x) => x.source === "auto");
    if (autos.length > 0)
      await tx
        .insert(schema.volunteerAssignments)
        .values(
          autos.map((x) => ({
            organizationId,
            eventId: row.eventId,
            versionId: row.id,
            shiftId: x.shiftId,
            applicationId: x.volunteerId,
            source: "auto" as const,
            locked: false,
            createdBy: actor.kind === "user" ? actor.userId : null,
          })),
        )
        .onConflictDoNothing();
    await tx
      .update(schema.scheduleGenerationRuns)
      .set({
        status: "succeeded",
        coveredCount: output.coveredCount,
        unfilledCount: output.unfilled.reduce((n, u) => n + u.missing, 0),
        diagnostics: {
          unfilled: output.unfilled,
          invalidLocks: output.invalidLocks,
          iterations: output.iterations,
          requiredTotal: output.requiredTotal,
        },
        score: output.score,
        solverStatus: output.solverStatus,
        durationMs: output.durationMs,
        finishedAt: new Date(),
      })
      .where(eq(schema.scheduleGenerationRuns.id, prepared.runId));
    await transitionVersion(tx, actor, row, "proposed");
    await emitDomainEvent(tx, {
      aggregateType: "schedule_version",
      aggregateId: row.id,
      eventType: "schedule.generated",
      organizationId,
      payload: {
        eventId: row.eventId,
        number: row.number,
        covered: output.coveredCount,
        required: output.requiredTotal,
      },
    });
  });
  const run = await getRun(db, actor, organizationId, prepared.runId);
  const version = (await listVersions(db, actor, organizationId, prepared.row.eventId)).find((x) => x.id === versionId);
  if (!version) throw new Error("reload failed");
  return { version, run, output };
}

export async function getRun(db: DbExecutor, actor: Actor, organizationId: string, runId: string): Promise<RunView> {
  const r = (
    await db
      .select()
      .from(schema.scheduleGenerationRuns)
      .where(
        and(
          eq(schema.scheduleGenerationRuns.id, runId),
          eq(schema.scheduleGenerationRuns.organizationId, organizationId),
        ),
      )
      .limit(1)
  )[0];
  if (!r) throw new NotFoundError("Exécution", runId);
  await authorize(db, actor, organizationId, r.eventId, "volunteers.review");
  return runView(r);
}

function runView(r: typeof schema.scheduleGenerationRuns.$inferSelect): RunView {
  const diag = r.diagnostics as { requiredTotal?: number } | null;
  return {
    id: r.id,
    versionId: r.versionId,
    algorithmVersion: r.algorithmVersion,
    inputHash: r.inputHash,
    weights: r.weights as EngineWeights,
    scope: (r.scope as string[] | null) ?? null,
    status: r.status,
    coveredCount: r.coveredCount,
    unfilledCount: r.unfilledCount,
    requiredTotal: diag?.requiredTotal ?? null,
    diagnostics: r.diagnostics,
    score: r.score,
    solverStatus: r.solverStatus,
    durationMs: r.durationMs,
    error: r.error,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}

export async function listRuns(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<RunView[]> {
  await authorize(db, actor, organizationId, eventId, "volunteers.review");
  const rows = await db
    .select()
    .from(schema.scheduleGenerationRuns)
    .where(
      and(
        eq(schema.scheduleGenerationRuns.organizationId, organizationId),
        eq(schema.scheduleGenerationRuns.eventId, eventId),
      ),
    )
    .orderBy(desc(schema.scheduleGenerationRuns.startedAt))
    .limit(50);
  return rows.map(runView);
}

/* ------------------------------------------------------------------------- */
/* detail, validation, diff                                                   */
/* ------------------------------------------------------------------------- */

async function computeDetail(db: DbExecutor, organizationId: string, row: VersionRow): Promise<VersionDetail> {
  const a = await assemble(db, organizationId, row.eventId);
  const assignments = await db
    .select()
    .from(schema.volunteerAssignments)
    .where(eq(schema.volunteerAssignments.versionId, row.id));
  const ids = assignments.map((x) => x.id);
  const [requests, attendance] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select()
            .from(schema.volunteerAssignmentRequests)
            .where(
              and(
                inArray(schema.volunteerAssignmentRequests.assignmentId, ids),
                eq(schema.volunteerAssignmentRequests.status, "open"),
              ),
            ),
          db.select().from(schema.volunteerAttendance).where(inArray(schema.volunteerAttendance.assignmentId, ids)),
        ]);
  // Names for assigned applications that may no longer be eligible (withdrawn etc.).
  const missingIds = assignments.map((x) => x.applicationId).filter((id) => !a.volunteerMeta.has(id));
  const extra =
    missingIds.length > 0
      ? await db
          .select({
            id: schema.volunteerApplications.id,
            firstName: schema.volunteerApplications.firstName,
            lastName: schema.volunteerApplications.lastName,
            email: schema.volunteerApplications.email,
            status: schema.volunteerApplications.status,
          })
          .from(schema.volunteerApplications)
          .where(inArray(schema.volunteerApplications.id, missingIds))
      : [];
  const nameOf = (id: string) => {
    const v = a.volunteers.find((x) => x.id === id);
    if (v) return v.name;
    const e = extra.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName}` : "Bénévole";
  };
  const emailOf = (id: string) => a.volunteerMeta.get(id)?.email ?? extra.find((e) => e.id === id)?.email ?? "";
  const violations = validateAssignments(
    assignments.map((x) => ({ shiftId: x.shiftId, volunteerId: x.applicationId })),
    a.shifts,
    a.volunteers,
    a.rules,
  );
  const shiftsById = new Map(a.shifts.map((s) => [s.id, s]));
  const conflicts: ConflictView[] = violations.map((vio) => {
    const asg = assignments.find((x) => x.shiftId === vio.shiftId && x.applicationId === vio.volunteerId);
    return {
      assignmentId: asg?.id ?? "",
      shiftId: vio.shiftId,
      applicationId: vio.volunteerId,
      volunteerName: nameOf(vio.volunteerId),
      positionName: shiftsById.get(vio.shiftId)?.positionName ?? "Créneau annulé",
      reason: vio.reason,
      label: HARD_REASON_LABELS[vio.reason],
    };
  });
  const heldOf = (volunteerId: string, excludeShift?: string) =>
    assignments
      .filter((x) => x.applicationId === volunteerId && x.shiftId !== excludeShift)
      .map((x) => shiftsById.get(x.shiftId))
      .filter((s): s is EngineShift => Boolean(s));
  const shifts: ShiftSlotView[] = a.shifts
    .map((s) => {
      const meta = a.shiftMeta.get(s.id);
      const own = assignments.filter((x) => x.shiftId === s.id);
      const views: AssignmentView[] = own.map((x) => {
        const req = requests.find((r) => r.assignmentId === x.id);
        const att = attendance.find((r) => r.assignmentId === x.id);
        return {
          id: x.id,
          shiftId: x.shiftId,
          applicationId: x.applicationId,
          volunteerName: nameOf(x.applicationId),
          volunteerEmail: emailOf(x.applicationId),
          source: x.source,
          locked: x.locked,
          confirmationStatus: x.confirmationStatus,
          confirmedAt: x.confirmedAt,
          openRequest: req ? { id: req.id, kind: req.kind, message: req.message, createdAt: req.createdAt } : null,
          attendance: att ? { status: att.status, note: att.note } : null,
        };
      });
      const candidates: ShiftSlotView["candidates"] = [];
      const excluded: ShiftSlotView["excluded"] = [];
      for (const v of a.volunteers) {
        if (own.some((x) => x.applicationId === v.id)) continue;
        // Personal reasons first (more useful to the organizer), capacity last.
        const reason = hardViolation(v, s, heldOf(v.id), a.rules) ?? (own.length >= s.max ? "shift_full" : null);
        if (reason) excluded.push({ applicationId: v.id, name: v.name, reason, label: HARD_REASON_LABELS[reason] });
        else
          candidates.push({ applicationId: v.id, name: v.name, preferenceRank: v.preferences[s.positionId] ?? null });
      }
      candidates.sort(
        (x, y) => (x.preferenceRank ?? 99) - (y.preferenceRank ?? 99) || x.name.localeCompare(y.name, "fr"),
      );
      return {
        shiftId: s.id,
        eventPositionId: meta?.eventPositionId ?? "",
        positionId: s.positionId,
        positionName: s.positionName,
        teamName: meta?.teamName ?? "",
        teamColor: meta?.teamColor ?? "neutral",
        label: meta?.label ?? null,
        startsAt: new Date(s.start),
        endsAt: new Date(s.end),
        requiredCount: s.required,
        maxCount: s.max,
        assignments: views.sort((x, y) => x.volunteerName.localeCompare(y.volunteerName, "fr")),
        missing: Math.max(0, s.required - own.length),
        candidates,
        excluded,
      };
    })
    .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime() || x.positionName.localeCompare(y.positionName, "fr"));
  const unfilled = shifts
    .filter((s) => s.missing > 0)
    .map((s) => ({
      shiftId: s.shiftId,
      positionName: s.positionName,
      label: s.label,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      missing: s.missing,
    }));
  const volunteers = a.volunteers.map((v) => {
    const mine = assignments.filter((x) => x.applicationId === v.id);
    const hours = mine.reduce((n, x) => {
      const s = shiftsById.get(x.shiftId);
      return n + (s ? (s.end - s.start) / 3_600_000 : 0);
    }, 0);
    return {
      applicationId: v.id,
      name: v.name,
      status: a.volunteerMeta.get(v.id)?.status ?? "",
      hours: Math.round(hours * 10) / 10,
      assignments: mine.length,
    };
  });
  const lastRunRow = (
    await db
      .select()
      .from(schema.scheduleGenerationRuns)
      .where(eq(schema.scheduleGenerationRuns.versionId, row.id))
      .orderBy(desc(schema.scheduleGenerationRuns.startedAt))
      .limit(1)
  )[0];
  const diag =
    (lastRunRow?.diagnostics as { invalidLocks?: Array<EngineAssignment & { reason: HardReason }> } | null) ?? null;
  const invalidLocks = (diag?.invalidLocks ?? []).map((l) => ({
    shiftId: l.shiftId,
    applicationId: l.volunteerId,
    reason: l.reason,
    label: HARD_REASON_LABELS[l.reason],
  }));
  const requiredTotal = a.shifts.reduce((n, s) => n + s.required, 0);
  const coveredCount = shifts.reduce((n, s) => n + Math.min(s.assignments.length, s.requiredCount), 0);
  const publishBlockers: string[] = [];
  if (!["draft", "proposed", "under_review"].includes(row.status))
    publishBlockers.push("Cette version n'est pas publiable dans son état actuel.");
  if (conflicts.length > 0) publishBlockers.push(`${conflicts.length} conflit(s) bloquant(s) à résoudre.`);
  if (assignments.length === 0) publishBlockers.push("Aucune affectation.");
  return {
    id: row.id,
    eventId: row.eventId,
    number: row.number,
    label: `V${row.number}`,
    status: row.status,
    basedOnVersionId: row.basedOnVersionId,
    notes: row.notes,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    supersededAt: row.supersededAt,
    unfilledAcknowledged: row.unfilledAcknowledged,
    version: row.version,
    assignmentsCount: assignments.length,
    requiredTotal,
    coveredCount,
    lastRunStatus: lastRunRow?.status ?? null,
    shifts,
    conflicts,
    unfilled,
    invalidLocks,
    volunteers,
    openRequests: requests.length,
    lastRun: lastRunRow ? runView(lastRunRow) : null,
    canPublish: publishBlockers.length === 0,
    publishBlockers,
  };
}

export async function getVersion(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  versionId: string,
): Promise<VersionDetail> {
  const row = await loadVersion(db, organizationId, versionId);
  await authorize(db, actor, organizationId, row.eventId, "volunteers.review");
  return computeDetail(db, organizationId, row);
}

export async function diffVersions(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  versionId: string,
  againstId: string | null,
): Promise<DiffEntry[]> {
  const row = await loadVersion(db, organizationId, versionId);
  await authorize(db, actor, organizationId, row.eventId, "volunteers.review");
  const other = againstId ? await loadVersion(db, organizationId, againstId) : null;
  if (other && other.eventId !== row.eventId) throw new NotFoundError("Version de planning", againstId ?? "");
  const [mine, theirs] = await Promise.all([
    db.select().from(schema.volunteerAssignments).where(eq(schema.volunteerAssignments.versionId, row.id)),
    other
      ? db.select().from(schema.volunteerAssignments).where(eq(schema.volunteerAssignments.versionId, other.id))
      : Promise.resolve([]),
  ]);
  return diffAssignments(db, organizationId, row.eventId, mine, theirs);
}

async function diffAssignments(
  db: DbExecutor,
  organizationId: string,
  eventId: string,
  mine: Array<{ shiftId: string; applicationId: string }>,
  theirs: Array<{ shiftId: string; applicationId: string }>,
): Promise<DiffEntry[]> {
  const a = await assemble(db, organizationId, eventId);
  const k = (x: { shiftId: string; applicationId: string }) => `${x.shiftId}|${x.applicationId}`;
  const theirKeys = new Set(theirs.map(k));
  const myKeys = new Set(mine.map(k));
  const ids = [...new Set([...mine, ...theirs].map((x) => x.applicationId))];
  const names =
    ids.length > 0
      ? await db
          .select({
            id: schema.volunteerApplications.id,
            firstName: schema.volunteerApplications.firstName,
            lastName: schema.volunteerApplications.lastName,
          })
          .from(schema.volunteerApplications)
          .where(inArray(schema.volunteerApplications.id, ids))
      : [];
  const allShifts = await db.select().from(schema.volunteerShifts).where(eq(schema.volunteerShifts.eventId, eventId));
  const entry = (x: { shiftId: string; applicationId: string }, change: "added" | "removed"): DiffEntry => {
    const s = allShifts.find((sh) => sh.id === x.shiftId);
    const n = names.find((nm) => nm.id === x.applicationId);
    return {
      applicationId: x.applicationId,
      volunteerName: n ? `${n.firstName} ${n.lastName}` : "Bénévole",
      shiftId: x.shiftId,
      positionName: a.shifts.find((sh) => sh.id === x.shiftId)?.positionName ?? "Créneau annulé",
      label: s?.label ?? null,
      startsAt: s?.startsAt ?? new Date(0),
      endsAt: s?.endsAt ?? new Date(0),
      change,
    };
  };
  return [
    ...mine.filter((x) => !theirKeys.has(k(x))).map((x) => entry(x, "added")),
    ...theirs.filter((x) => !myKeys.has(k(x))).map((x) => entry(x, "removed")),
  ].sort((x, y) => x.volunteerName.localeCompare(y.volunteerName, "fr") || x.startsAt.getTime() - y.startsAt.getTime());
}

/* ------------------------------------------------------------------------- */
/* manual edits                                                               */
/* ------------------------------------------------------------------------- */

async function bump(tx: DbExecutor, row: VersionRow) {
  await tx
    .update(schema.scheduleVersions)
    .set({ version: row.version + 1 })
    .where(eq(schema.scheduleVersions.id, row.id));
}

export async function assignVolunteer(
  db: Database,
  actor: Actor,
  organizationId: string,
  versionId: string,
  input: AssignInput,
): Promise<VersionDetail> {
  const v = assignSchema.parse(input);
  const head = await loadVersion(db, organizationId, versionId);
  await authorize(db, actor, organizationId, head.eventId, "volunteers.schedule");
  await db.transaction(async (tx) => {
    const row = await loadVersion(tx, organizationId, versionId, true);
    assertEditable(row);
    const a = await assemble(tx, organizationId, row.eventId);
    const shift = a.shifts.find((s) => s.id === v.shiftId);
    if (!shift) throw new NotFoundError("Créneau", v.shiftId);
    const volunteer = a.volunteers.find((x) => x.id === v.applicationId);
    if (!volunteer)
      throw new PreconditionFailedError("Cette personne n'est pas un·e bénévole accepté·e de l'événement.", {
        code: "volunteer_not_eligible",
      });
    const existing = await tx
      .select()
      .from(schema.volunteerAssignments)
      .where(eq(schema.volunteerAssignments.versionId, row.id));
    if (existing.some((e) => e.shiftId === shift.id && e.applicationId === volunteer.id))
      throw new ConflictError("Déjà affecté·e à ce créneau.", { code: "already_assigned" });
    const held = existing
      .filter((e) => e.applicationId === volunteer.id)
      .map((e) => a.shifts.find((s) => s.id === e.shiftId))
      .filter((s): s is EngineShift => Boolean(s));
    const onShift = existing.filter((e) => e.shiftId === shift.id).length;
    const reason = hardViolation(volunteer, shift, held, a.rules) ?? (onShift >= shift.max ? "shift_full" : null);
    if (reason) throw new PreconditionFailedError(HARD_REASON_LABELS[reason], { code: "hard_constraint", reason });
    await tx.insert(schema.volunteerAssignments).values({
      organizationId,
      eventId: row.eventId,
      versionId: row.id,
      shiftId: shift.id,
      applicationId: volunteer.id,
      source: "manual",
      locked: v.lock ?? false,
      createdBy: actor.kind === "user" ? actor.userId : null,
    });
    await bump(tx, row);
    await recordAudit(tx, actor, {
      organizationId,
      action: "schedule_assignment.added",
      targetType: "schedule_version",
      targetId: row.id,
      metadata: { shiftId: shift.id, applicationId: volunteer.id, locked: v.lock ?? false },
    });
  });
  return getVersion(db, actor, organizationId, versionId);
}

export async function unassignVolunteer(
  db: Database,
  actor: Actor,
  organizationId: string,
  versionId: string,
  assignmentId: string,
): Promise<VersionDetail> {
  const head = await loadVersion(db, organizationId, versionId);
  await authorize(db, actor, organizationId, head.eventId, "volunteers.schedule");
  await db.transaction(async (tx) => {
    const row = await loadVersion(tx, organizationId, versionId, true);
    assertEditable(row);
    const deleted = await tx
      .delete(schema.volunteerAssignments)
      .where(and(eq(schema.volunteerAssignments.id, assignmentId), eq(schema.volunteerAssignments.versionId, row.id)))
      .returning({
        shiftId: schema.volunteerAssignments.shiftId,
        applicationId: schema.volunteerAssignments.applicationId,
      });
    if (deleted.length === 0) throw new NotFoundError("Affectation", assignmentId);
    await bump(tx, row);
    await recordAudit(tx, actor, {
      organizationId,
      action: "schedule_assignment.removed",
      targetType: "schedule_version",
      targetId: row.id,
      metadata: { ...deleted[0] },
    });
  });
  return getVersion(db, actor, organizationId, versionId);
}

export async function setAssignmentLock(
  db: Database,
  actor: Actor,
  organizationId: string,
  versionId: string,
  assignmentId: string,
  locked: boolean,
): Promise<VersionDetail> {
  const head = await loadVersion(db, organizationId, versionId);
  await authorize(db, actor, organizationId, head.eventId, "volunteers.schedule");
  await db.transaction(async (tx) => {
    const row = await loadVersion(tx, organizationId, versionId, true);
    assertEditable(row);
    const updated = await tx
      .update(schema.volunteerAssignments)
      .set({ locked })
      .where(and(eq(schema.volunteerAssignments.id, assignmentId), eq(schema.volunteerAssignments.versionId, row.id)))
      .returning({ id: schema.volunteerAssignments.id });
    if (updated.length === 0) throw new NotFoundError("Affectation", assignmentId);
    await bump(tx, row);
    await recordAudit(tx, actor, {
      organizationId,
      action: locked ? "schedule_assignment.locked" : "schedule_assignment.unlocked",
      targetType: "schedule_version",
      targetId: row.id,
      metadata: { assignmentId },
    });
  });
  return getVersion(db, actor, organizationId, versionId);
}

export async function markUnderReview(
  db: Database,
  actor: Actor,
  organizationId: string,
  versionId: string,
): Promise<VersionDetail> {
  const head = await loadVersion(db, organizationId, versionId);
  await authorize(db, actor, organizationId, head.eventId, "volunteers.schedule");
  await db.transaction(async (tx) => {
    const row = await loadVersion(tx, organizationId, versionId, true);
    if (row.status === "under_review") return;
    await transitionVersion(tx, actor, row, "under_review");
  });
  return getVersion(db, actor, organizationId, versionId);
}

/* ------------------------------------------------------------------------- */
/* publication                                                                */
/* ------------------------------------------------------------------------- */

export interface PublishResult {
  version: VersionDetail;
  supersededVersionId: string | null;
  notified: number;
  changes: DiffEntry[];
}

/**
 * Publish: transaction under the event lock, optimistic `expectedVersion`, full re-validation on
 * CURRENT data (not the run snapshot), unfilled positions require an explicit acknowledgement.
 * Supersedes the current published version, moves applications to assigned, notifies each
 * volunteer with ONLY their changed missions.
 */
export async function publishVersion(
  db: Database,
  ctx: VolunteerContext,
  actor: Actor,
  organizationId: string,
  versionId: string,
  input: PublishInput,
  now = new Date(),
): Promise<PublishResult> {
  const v = publishSchema.parse(input);
  const head = await loadVersion(db, organizationId, versionId);
  await authorize(db, actor, organizationId, head.eventId, "schedules.publish");
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, head.eventId))
      .for("update");
    const row = await loadVersion(tx, organizationId, versionId, true);
    if (row.version !== v.expectedVersion)
      throw new ConflictError("Cette version a été modifiée entre-temps : rechargez avant de publier.", {
        code: "stale_version",
        currentVersion: row.version,
      });
    if (!["draft", "proposed", "under_review"].includes(row.status))
      throw new PreconditionFailedError("Cette version n'est pas publiable.", {
        code: "not_publishable",
        status: row.status,
      });
    const detail = await computeDetail(tx, organizationId, row);
    if (detail.conflicts.length > 0)
      throw new PreconditionFailedError(`${detail.conflicts.length} conflit(s) bloquant(s) : publication refusée.`, {
        code: "conflicts",
        conflicts: detail.conflicts.map((c) => ({
          shiftId: c.shiftId,
          applicationId: c.applicationId,
          reason: c.reason,
        })),
      });
    if (detail.assignmentsCount === 0)
      throw new PreconditionFailedError("Aucune affectation à publier.", { code: "empty" });
    if (detail.unfilled.length > 0 && !v.acknowledgeUnfilled)
      throw new PreconditionFailedError(
        `${detail.unfilled.reduce((n, u) => n + u.missing, 0)} affectation(s) requise(s) non pourvue(s) : confirmez explicitement pour publier malgré tout.`,
        { code: "unfilled", unfilled: detail.unfilled.map((u) => ({ shiftId: u.shiftId, missing: u.missing })) },
      );
    const previous = (
      await tx
        .select()
        .from(schema.scheduleVersions)
        .where(and(eq(schema.scheduleVersions.eventId, row.eventId), eq(schema.scheduleVersions.status, "published")))
        .for("update")
        .limit(1)
    )[0];
    const mine = await tx
      .select()
      .from(schema.volunteerAssignments)
      .where(eq(schema.volunteerAssignments.versionId, row.id));
    const theirs = previous
      ? await tx
          .select()
          .from(schema.volunteerAssignments)
          .where(eq(schema.volunteerAssignments.versionId, previous.id))
      : [];
    const changes = await diffAssignments(tx, organizationId, row.eventId, mine, theirs);
    if (previous) {
      await transitionVersion(tx, actor, previous, "superseded", { supersededAt: now });
    }
    if (row.status !== "under_review")
      await transitionVersion(tx, actor, { ...row, version: row.version }, "under_review");
    const current = await loadVersion(tx, organizationId, versionId, true);
    await transitionVersion(tx, actor, current, "published", {
      publishedAt: now,
      publishedBy: actor.kind === "user" ? actor.userId : null,
      unfilledAcknowledged: detail.unfilled.length > 0,
      notes: v.notes ?? current.notes,
    });
    // Carry confirmations of unchanged missions over from the previous version.
    const prevConfirmed = new Set(
      theirs.filter((t) => t.confirmationStatus === "confirmed").map((t) => `${t.shiftId}|${t.applicationId}`),
    );
    for (const m of mine) {
      if (prevConfirmed.has(`${m.shiftId}|${m.applicationId}`))
        await tx
          .update(schema.volunteerAssignments)
          .set({ confirmationStatus: "confirmed", confirmedAt: now })
          .where(eq(schema.volunteerAssignments.id, m.id));
    }
    // Application statuses: assigned for everyone in this version; back to approved for those dropped.
    const assignedIds = new Set(mine.map((m) => m.applicationId));
    const droppedIds = new Set(theirs.map((t) => t.applicationId).filter((id) => !assignedIds.has(id)));
    const apps = await tx
      .select()
      .from(schema.volunteerApplications)
      .where(inArray(schema.volunteerApplications.id, [...new Set([...assignedIds, ...droppedIds])]));
    for (const app of apps) {
      const target = assignedIds.has(app.id)
        ? mine
            .filter((m) => m.applicationId === app.id)
            .every((m) => prevConfirmed.has(`${m.shiftId}|${m.applicationId}`)) && app.status === "confirmed"
          ? "confirmed"
          : "assigned"
        : "approved";
      if (app.status === target) continue;
      if (!volunteerApplicationStateMachine.canTransition(app.status, target)) continue;
      await tx
        .update(schema.volunteerApplications)
        .set({ status: target, version: app.version + 1 })
        .where(eq(schema.volunteerApplications.id, app.id));
    }
    // CRM (phase 7): every volunteer concerned by this publication is a touchpoint (mission counters).
    for (const app of apps) {
      await recordTouchpoint(tx, {
        organizationId,
        source: "schedule",
        sourceId: row.id,
        sourceLabel: `planning V${row.number}`,
        email: app.email,
        firstName: app.firstName,
        lastName: app.lastName,
        phone: app.phone,
        userId: app.userId,
        occurredAt: now,
        marketingOptIn: null,
      });
    }
    await emitDomainEvent(tx, {
      aggregateType: "schedule_version",
      aggregateId: row.id,
      eventType: "schedule.published",
      organizationId,
      payload: {
        eventId: row.eventId,
        number: row.number,
        supersededVersionId: previous?.id ?? null,
        changes: changes.length,
      },
    });
    return { previousId: previous?.id ?? null, changes, mine, theirs, apps };
  });
  // Notifications (outside the transaction): one e-mail per volunteer concerned, changed missions only.
  const a = await assemble(db, organizationId, head.eventId);
  const detail = await getVersion(db, actor, organizationId, versionId);
  const concerned = new Set([...result.mine.map((m) => m.applicationId), ...result.theirs.map((t) => t.applicationId)]);
  let notified = 0;
  for (const applicationId of concerned) {
    const app = result.apps.find((x) => x.id === applicationId);
    const meta = a.volunteerMeta.get(applicationId);
    if (!app || !meta) continue;
    const myNow = result.mine.filter((m) => m.applicationId === applicationId);
    const myBefore = result.theirs.filter((t) => t.applicationId === applicationId);
    const lines = [
      ...myNow.map((m) => {
        const s = detail.shifts.find((sh) => sh.shiftId === m.shiftId);
        const existed = myBefore.some((t) => t.shiftId === m.shiftId);
        return {
          positionName: s?.positionName ?? "",
          label: s?.label ?? null,
          startsAt: s?.startsAt ?? new Date(0),
          endsAt: s?.endsAt ?? new Date(0),
          change: existed ? ("unchanged" as const) : ("new" as const),
        };
      }),
      ...myBefore
        .filter((t) => !myNow.some((m) => m.shiftId === t.shiftId))
        .map((t) => {
          const c = result.changes.find((ch) => ch.shiftId === t.shiftId && ch.applicationId === applicationId);
          return {
            positionName: c?.positionName ?? "",
            label: c?.label ?? null,
            startsAt: c?.startsAt ?? new Date(0),
            endsAt: c?.endsAt ?? new Date(0),
            change: "removed" as const,
          };
        }),
    ];
    if (result.previousId && lines.every((l) => l.change === "unchanged")) continue;
    const token = deriveToken(ctx.credentialSecret, VOLUNTEER_TOKEN_SCOPE, applicationId, meta.secretVersion);
    await sendMissionsPublished(
      ctx,
      meta.email,
      app.firstName,
      {
        organizationName:
          (
            await db
              .select({ n: schema.organizations.name })
              .from(schema.organizations)
              .where(eq(schema.organizations.id, organizationId))
              .limit(1)
          )[0]?.n ?? "",
        eventTitle: a.event.title,
        timezone: a.event.timezone,
        versionLabel: detail.label,
        trackingUrl: `${ctx.appUrl}/candidature/${applicationId}?k=${token}`,
      },
      lines,
    ).catch(() => undefined);
    notified += 1;
    await db
      .update(schema.volunteerAssignments)
      .set({ notifiedAt: now })
      .where(
        and(
          eq(schema.volunteerAssignments.versionId, versionId),
          eq(schema.volunteerAssignments.applicationId, applicationId),
        ),
      );
  }
  return { version: detail, supersededVersionId: result.previousId, notified, changes: result.changes };
}

/* ------------------------------------------------------------------------- */
/* volunteer side: missions, confirmation, unavailability                     */
/* ------------------------------------------------------------------------- */

export interface MissionView {
  assignmentId: string;
  versionLabel: string;
  positionName: string;
  teamName: string;
  label: string | null;
  briefing: string | null;
  instructions: string | null;
  startsAt: Date;
  endsAt: Date;
  confirmationStatus: "pending" | "confirmed" | "declined";
  openRequest: { kind: "unavailable" | "replacement"; createdAt: Date } | null;
}

async function authorizeCandidate(
  db: DbExecutor,
  applicationId: string,
  auth: { accessToken?: string | null | undefined; actor?: Actor | undefined; email?: string | undefined },
) {
  const row = (
    await db
      .select()
      .from(schema.volunteerApplications)
      .where(eq(schema.volunteerApplications.id, applicationId))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("Candidature", applicationId);
  const byToken = auth.accessToken ? tokensEqual(hashToken(auth.accessToken), row.accessTokenHash) : false;
  const byUser =
    auth.actor?.kind === "user" &&
    ((row.userId !== null && row.userId === auth.actor.userId) ||
      (auth.email !== undefined && auth.email.toLowerCase() === row.email));
  if (!byToken && !byUser) throw new NotFoundError("Candidature", applicationId);
  return row;
}

/** Published missions of a candidate (never a draft, never other volunteers). */
export async function listMissions(
  db: DbExecutor,
  applicationId: string,
  auth: Parameters<typeof authorizeCandidate>[2],
): Promise<MissionView[]> {
  const app = await authorizeCandidate(db, applicationId, auth);
  const published = (
    await db
      .select()
      .from(schema.scheduleVersions)
      .where(and(eq(schema.scheduleVersions.eventId, app.eventId), eq(schema.scheduleVersions.status, "published")))
      .limit(1)
  )[0];
  if (!published) return [];
  const rows = await db
    .select({ a: schema.volunteerAssignments, s: schema.volunteerShifts, ep: schema.eventVolunteerPositions })
    .from(schema.volunteerAssignments)
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerAssignments.shiftId))
    .innerJoin(
      schema.eventVolunteerPositions,
      eq(schema.eventVolunteerPositions.id, schema.volunteerShifts.eventPositionId),
    )
    .where(
      and(
        eq(schema.volunteerAssignments.versionId, published.id),
        eq(schema.volunteerAssignments.applicationId, app.id),
      ),
    )
    .orderBy(asc(schema.volunteerShifts.startsAt));
  if (rows.length === 0) return [];
  const templates = await loadPositionsUnchecked(
    db,
    app.organizationId,
    rows.map((r) => r.ep.positionId),
  );
  const requests = await db
    .select()
    .from(schema.volunteerAssignmentRequests)
    .where(
      and(
        inArray(
          schema.volunteerAssignmentRequests.assignmentId,
          rows.map((r) => r.a.id),
        ),
        eq(schema.volunteerAssignmentRequests.status, "open"),
      ),
    );
  return rows.map((r) => {
    const t = templates.find((x) => x.id === r.ep.positionId);
    const req = requests.find((q) => q.assignmentId === r.a.id);
    return {
      assignmentId: r.a.id,
      versionLabel: `V${published.number}`,
      positionName: t?.name ?? "Poste",
      teamName: t?.teamName ?? "",
      label: r.s.label,
      briefing: r.ep.briefing,
      instructions: t?.instructions ?? null,
      startsAt: r.s.startsAt,
      endsAt: r.s.endsAt,
      confirmationStatus: r.a.confirmationStatus,
      openRequest: req ? { kind: req.kind, createdAt: req.createdAt } : null,
    };
  });
}

export async function confirmMission(
  db: Database,
  applicationId: string,
  auth: Parameters<typeof authorizeCandidate>[2],
  assignmentId: string,
  now = new Date(),
): Promise<MissionView[]> {
  const app = await authorizeCandidate(db, applicationId, auth);
  await db.transaction(async (tx) => {
    const asg = (
      await tx
        .select()
        .from(schema.volunteerAssignments)
        .where(
          and(eq(schema.volunteerAssignments.id, assignmentId), eq(schema.volunteerAssignments.applicationId, app.id)),
        )
        .for("update")
        .limit(1)
    )[0];
    if (!asg) throw new NotFoundError("Mission", assignmentId);
    const version = await loadVersion(tx, app.organizationId, asg.versionId);
    if (version.status !== "published")
      throw new PreconditionFailedError("Cette mission n'est pas publiée.", { code: "not_published" });
    await tx
      .update(schema.volunteerAssignments)
      .set({ confirmationStatus: "confirmed", confirmedAt: now, declinedAt: null })
      .where(eq(schema.volunteerAssignments.id, asg.id));
    const all = await tx
      .select()
      .from(schema.volunteerAssignments)
      .where(
        and(
          eq(schema.volunteerAssignments.versionId, version.id),
          eq(schema.volunteerAssignments.applicationId, app.id),
        ),
      );
    if (all.every((x) => x.confirmationStatus === "confirmed") && app.status === "assigned") {
      await tx
        .update(schema.volunteerApplications)
        .set({ status: "confirmed", version: app.version + 1 })
        .where(eq(schema.volunteerApplications.id, app.id));
    }
    await recordAudit(tx, auth.actor ?? { kind: "anonymous" }, {
      organizationId: app.organizationId,
      action: "schedule_assignment.confirmed",
      targetType: "volunteer_application",
      targetId: app.id,
      metadata: { assignmentId },
    });
  });
  return listMissions(db, applicationId, auth);
}

/** The volunteer reports an unavailability: the assignment stays, an open request asks for arbitration. */
export async function reportUnavailable(
  db: Database,
  ctx: VolunteerContext,
  applicationId: string,
  auth: Parameters<typeof authorizeCandidate>[2],
  assignmentId: string,
  message: string | undefined,
  now = new Date(),
): Promise<MissionView[]> {
  const app = await authorizeCandidate(db, applicationId, auth);
  const info = await db.transaction(async (tx) => {
    const asg = (
      await tx
        .select()
        .from(schema.volunteerAssignments)
        .where(
          and(eq(schema.volunteerAssignments.id, assignmentId), eq(schema.volunteerAssignments.applicationId, app.id)),
        )
        .for("update")
        .limit(1)
    )[0];
    if (!asg) throw new NotFoundError("Mission", assignmentId);
    const version = await loadVersion(tx, app.organizationId, asg.versionId);
    if (version.status !== "published")
      throw new PreconditionFailedError("Cette mission n'est pas publiée.", { code: "not_published" });
    const open = (
      await tx
        .select({ id: schema.volunteerAssignmentRequests.id })
        .from(schema.volunteerAssignmentRequests)
        .where(
          and(
            eq(schema.volunteerAssignmentRequests.assignmentId, asg.id),
            eq(schema.volunteerAssignmentRequests.status, "open"),
          ),
        )
        .limit(1)
    )[0];
    if (open)
      throw new ConflictError("Un signalement est déjà en attente d'arbitrage pour cette mission.", {
        code: "request_open",
      });
    await tx.insert(schema.volunteerAssignmentRequests).values({
      organizationId: app.organizationId,
      eventId: app.eventId,
      assignmentId: asg.id,
      applicationId: app.id,
      kind: "unavailable",
      message: message ?? null,
    });
    await tx
      .update(schema.volunteerAssignments)
      .set({ confirmationStatus: "declined", declinedAt: now })
      .where(eq(schema.volunteerAssignments.id, asg.id));
    if (app.status === "confirmed")
      await tx
        .update(schema.volunteerApplications)
        .set({ status: "assigned", version: app.version + 1 })
        .where(eq(schema.volunteerApplications.id, app.id));
    await recordAudit(tx, auth.actor ?? { kind: "anonymous" }, {
      organizationId: app.organizationId,
      action: "schedule_assignment.unavailable_reported",
      targetType: "volunteer_application",
      targetId: app.id,
      metadata: { assignmentId, message: message ?? null },
    });
    await emitDomainEvent(tx, {
      aggregateType: "volunteer_assignment",
      aggregateId: asg.id,
      eventType: "schedule.unavailability_reported",
      organizationId: app.organizationId,
      payload: { eventId: app.eventId, applicationId: app.id },
    });
    const shift = (
      await tx.select().from(schema.volunteerShifts).where(eq(schema.volunteerShifts.id, asg.shiftId)).limit(1)
    )[0];
    const event = (
      await tx
        .select({ title: schema.events.title })
        .from(schema.events)
        .where(eq(schema.events.id, app.eventId))
        .limit(1)
    )[0];
    return { shift, eventTitle: event?.title ?? "", secretVersion: app.secretVersion };
  });
  const token = deriveToken(ctx.credentialSecret, VOLUNTEER_TOKEN_SCOPE, app.id, info.secretVersion);
  await sendUnavailabilityReceived(ctx, app.email, {
    eventTitle: info.eventTitle,
    mission: info.shift?.label ?? "mission",
    trackingUrl: `${ctx.appUrl}/candidature/${app.id}?k=${token}`,
  }).catch(() => undefined);
  return listMissions(db, applicationId, auth);
}

/* ------------------------------------------------------------------------- */
/* requests and attendance (organizer)                                        */
/* ------------------------------------------------------------------------- */

export interface RequestView {
  id: string;
  assignmentId: string;
  applicationId: string;
  volunteerName: string;
  positionName: string;
  label: string | null;
  startsAt: Date;
  endsAt: Date;
  kind: "unavailable" | "replacement";
  message: string | null;
  status: "open" | "resolved" | "dismissed";
  resolution: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export async function listRequests(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
  status: "open" | "all" = "open",
): Promise<RequestView[]> {
  await authorize(db, actor, organizationId, eventId, "volunteers.review");
  const conditions = [
    eq(schema.volunteerAssignmentRequests.organizationId, organizationId),
    eq(schema.volunteerAssignmentRequests.eventId, eventId),
  ];
  if (status === "open") conditions.push(eq(schema.volunteerAssignmentRequests.status, "open"));
  const rows = await db
    .select({
      r: schema.volunteerAssignmentRequests,
      a: schema.volunteerApplications,
      asg: schema.volunteerAssignments,
      s: schema.volunteerShifts,
      ep: schema.eventVolunteerPositions,
    })
    .from(schema.volunteerAssignmentRequests)
    .innerJoin(
      schema.volunteerApplications,
      eq(schema.volunteerApplications.id, schema.volunteerAssignmentRequests.applicationId),
    )
    .innerJoin(
      schema.volunteerAssignments,
      eq(schema.volunteerAssignments.id, schema.volunteerAssignmentRequests.assignmentId),
    )
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerAssignments.shiftId))
    .innerJoin(
      schema.eventVolunteerPositions,
      eq(schema.eventVolunteerPositions.id, schema.volunteerShifts.eventPositionId),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.volunteerAssignmentRequests.createdAt));
  const templates =
    rows.length > 0
      ? await loadPositionsUnchecked(db, organizationId, [...new Set(rows.map((r) => r.ep.positionId))])
      : [];
  return rows.map((r) => ({
    id: r.r.id,
    assignmentId: r.r.assignmentId,
    applicationId: r.r.applicationId,
    volunteerName: `${r.a.firstName} ${r.a.lastName}`,
    positionName: templates.find((t) => t.id === r.ep.positionId)?.name ?? "Poste",
    label: r.s.label,
    startsAt: r.s.startsAt,
    endsAt: r.s.endsAt,
    kind: r.r.kind,
    message: r.r.message,
    status: r.r.status,
    resolution: r.r.resolution,
    createdAt: r.r.createdAt,
    resolvedAt: r.r.resolvedAt,
  }));
}

export async function resolveRequest(
  db: Database,
  actor: Actor,
  organizationId: string,
  requestId: string,
  outcome: "resolved" | "dismissed",
  resolution: string,
  now = new Date(),
): Promise<void> {
  const row = (
    await db
      .select()
      .from(schema.volunteerAssignmentRequests)
      .where(
        and(
          eq(schema.volunteerAssignmentRequests.id, requestId),
          eq(schema.volunteerAssignmentRequests.organizationId, organizationId),
        ),
      )
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("Demande", requestId);
  await authorize(db, actor, organizationId, row.eventId, "volunteers.schedule");
  if (row.status !== "open") throw new PreconditionFailedError("Demande déjà traitée.", { code: "request_closed" });
  await db.transaction(async (tx) => {
    await tx
      .update(schema.volunteerAssignmentRequests)
      .set({ status: outcome, resolution, resolvedBy: actor.kind === "user" ? actor.userId : null, resolvedAt: now })
      .where(eq(schema.volunteerAssignmentRequests.id, row.id));
    if (outcome === "dismissed") {
      // The organizer keeps the volunteer on the mission: back to pending confirmation.
      await tx
        .update(schema.volunteerAssignments)
        .set({ confirmationStatus: "pending", declinedAt: null })
        .where(eq(schema.volunteerAssignments.id, row.assignmentId));
    }
    await recordAudit(tx, actor, {
      organizationId,
      action: `schedule_request.${outcome}`,
      targetType: "volunteer_application",
      targetId: row.applicationId,
      metadata: { requestId, resolution },
    });
  });
}

export async function recordAttendance(
  db: Database,
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: AttendanceInput,
  now = new Date(),
): Promise<void> {
  const v = attendanceSchema.parse(input);
  const asg = (
    await db
      .select()
      .from(schema.volunteerAssignments)
      .where(
        and(
          eq(schema.volunteerAssignments.id, assignmentId),
          eq(schema.volunteerAssignments.organizationId, organizationId),
        ),
      )
      .limit(1)
  )[0];
  if (!asg) throw new NotFoundError("Affectation", assignmentId);
  if (actor.kind === "user") {
    try {
      await authorize(db, actor, organizationId, asg.eventId, "volunteers.schedule");
    } catch {
      await authorize(db, actor, organizationId, asg.eventId, "checkins.scan");
    }
  }
  const version = await loadVersion(db, organizationId, asg.versionId);
  if (version.status !== "published")
    throw new PreconditionFailedError("La présence se note sur le planning publié.", { code: "not_published" });
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.volunteerAttendance)
      .values({
        organizationId,
        eventId: asg.eventId,
        assignmentId: asg.id,
        applicationId: asg.applicationId,
        status: v.status,
        note: v.note ?? null,
        checkedInAt: v.status === "present" || v.status === "late" ? now : null,
        recordedBy: actor.kind === "user" ? actor.userId : null,
      })
      .onConflictDoUpdate({
        target: schema.volunteerAttendance.assignmentId,
        set: {
          status: v.status,
          note: v.note ?? null,
          recordedBy: actor.kind === "user" ? actor.userId : null,
          checkedInAt: v.status === "present" || v.status === "late" ? now : null,
        },
      });
    await recordAudit(tx, actor, {
      organizationId,
      action: "volunteer_attendance.recorded",
      targetType: "volunteer_application",
      targetId: asg.applicationId,
      metadata: { assignmentId, status: v.status },
    });
  });
}

/** Organization-level overview: per event, published version, coverage, open requests. */
export interface PlanningOverviewItem {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  startsAt: Date;
  publishedVersion: VersionSummary | null;
  latestVersion: VersionSummary | null;
  requiredTotal: number;
  openRequests: number;
}

export async function planningOverview(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventIds: string[],
): Promise<PlanningOverviewItem[]> {
  const out: PlanningOverviewItem[] = [];
  for (const eventId of eventIds) {
    const event = (
      await db
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.id, eventId), eq(schema.events.organizationId, organizationId)))
        .limit(1)
    )[0];
    if (!event) continue;
    const list = await listVersions(db, actor, organizationId, eventId);
    const open = (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.volunteerAssignmentRequests)
        .where(
          and(
            eq(schema.volunteerAssignmentRequests.eventId, eventId),
            eq(schema.volunteerAssignmentRequests.status, "open"),
          ),
        )
    )[0];
    out.push({
      eventId,
      eventTitle: event.title,
      eventSlug: event.slug,
      startsAt: event.startsAt,
      publishedVersion: list.find((v) => v.status === "published") ?? null,
      latestVersion: list[0] ?? null,
      requiredTotal: list[0]?.requiredTotal ?? 0,
      openRequests: open?.n ?? 0,
    });
  }
  return out;
}
