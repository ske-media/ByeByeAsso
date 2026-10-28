import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { type Actor, NotFoundError, PreconditionFailedError } from "../kernel";
import { loadPositionsUnchecked, loadSkillsUnchecked, type PositionView } from "./catalogue";
import {
  type EventPositionInput,
  eventPositionSchema,
  type ShiftInput,
  shiftSchema,
  type VolunteeringSettingsInput,
  volunteeringSettingsSchema,
} from "./schemas";

export interface ShiftView {
  id: string;
  eventPositionId: string;
  label: string | null;
  startsAt: Date;
  endsAt: Date;
  requiredCount: number;
  maxCount: number;
  notes: string | null;
  status: "active" | "cancelled";
  version: number;
}

export interface EventPositionView {
  id: string;
  eventId: string;
  positionId: string;
  name: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  description: string | null;
  briefing: string | null;
  instructions: string | null;
  minAge: number | null;
  skills: PositionView["skills"];
  status: "active" | "archived";
  shifts: ShiftView[];
  requiredTotal: number;
}

export interface QuestionView {
  id: string;
  key: string;
  label: string;
  helpText: string | null;
  type: "short_text" | "long_text" | "single_choice" | "checkbox";
  required: boolean;
  options: string[];
}

export interface VolunteeringView {
  eventId: string;
  recruitmentStatus: "closed" | "open";
  targetCount: number;
  maxHoursPerDay: number;
  minRestMinutes: number;
  questions: QuestionView[];
  positions: EventPositionView[];
  /** Σ required over active shifts of active positions. */
  requiredTotal: number;
}

/** Public: what a candidate sees (no counters beyond positions and shift times). */
export interface PublicVolunteering {
  open: boolean;
  closedReason: string | null;
  targetCount: number;
  positions: Array<{
    id: string;
    name: string;
    teamName: string;
    description: string | null;
    minAge: number | null;
    skills: Array<{ skillId: string; name: string; mandatory: boolean }>;
    shifts: Array<{ id: string; label: string | null; startsAt: Date; endsAt: Date }>;
  }>;
  skills: Array<{ id: string; name: string; requiresVerification: boolean }>;
  questions: QuestionView[];
}

const FORM_PURPOSE = "volunteer_application" as const;

async function loadEventRow(tx: DbExecutor, organizationId: string, eventId: string) {
  const row = (
    await tx
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.id, eventId), eq(schema.events.organizationId, organizationId)))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("Événement", eventId);
  return row;
}

export async function loadQuestionsUnchecked(
  db: DbExecutor,
  organizationId: string,
  eventId: string,
): Promise<QuestionView[]> {
  const form = (
    await db
      .select({ id: schema.formDefinitions.id })
      .from(schema.formDefinitions)
      .where(
        and(
          eq(schema.formDefinitions.organizationId, organizationId),
          eq(schema.formDefinitions.eventId, eventId),
          eq(schema.formDefinitions.purpose, FORM_PURPOSE),
          eq(schema.formDefinitions.isActive, true),
        ),
      )
      .limit(1)
  )[0];
  if (!form) return [];
  const fields = await db
    .select()
    .from(schema.formFields)
    .where(eq(schema.formFields.formId, form.id))
    .orderBy(asc(schema.formFields.position));
  return fields.map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    helpText: f.helpText,
    type: f.type as QuestionView["type"],
    required: f.required,
    options: (f.options as Array<{ value: string; label: string }>).map((o) => o.label),
  }));
}

export async function loadEventPositionsUnchecked(
  db: DbExecutor,
  organizationId: string,
  eventId: string,
): Promise<EventPositionView[]> {
  const rows = await db
    .select()
    .from(schema.eventVolunteerPositions)
    .where(
      and(
        eq(schema.eventVolunteerPositions.organizationId, organizationId),
        eq(schema.eventVolunteerPositions.eventId, eventId),
      ),
    );
  if (rows.length === 0) return [];
  const templates = await loadPositionsUnchecked(
    db,
    organizationId,
    rows.map((r) => r.positionId),
  );
  const shifts = await db
    .select()
    .from(schema.volunteerShifts)
    .where(
      inArray(
        schema.volunteerShifts.eventPositionId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(schema.volunteerShifts.startsAt), asc(schema.volunteerShifts.endsAt));
  const out: EventPositionView[] = [];
  for (const t of templates) {
    const row = rows.find((r) => r.positionId === t.id);
    if (!row) continue;
    const own = shifts
      .filter((s) => s.eventPositionId === row.id)
      .map((s) => ({
        id: s.id,
        eventPositionId: s.eventPositionId,
        label: s.label,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        requiredCount: s.requiredCount,
        maxCount: s.maxCount,
        notes: s.notes,
        status: s.status,
        version: s.version,
      }));
    out.push({
      id: row.id,
      eventId,
      positionId: t.id,
      name: t.name,
      teamId: t.teamId,
      teamName: t.teamName,
      teamColor: t.teamColor,
      description: t.description,
      briefing: row.briefing,
      instructions: t.instructions,
      minAge: t.minAge,
      skills: t.skills,
      status: row.status,
      shifts: own,
      requiredTotal: own.filter((s) => s.status === "active").reduce((a, s) => a + s.requiredCount, 0),
    });
  }
  return out;
}

export async function loadVolunteeringUnchecked(
  db: DbExecutor,
  organizationId: string,
  eventId: string,
): Promise<VolunteeringView> {
  const event = await loadEventRow(db, organizationId, eventId);
  const [questions, positions] = await Promise.all([
    loadQuestionsUnchecked(db, organizationId, eventId),
    loadEventPositionsUnchecked(db, organizationId, eventId),
  ]);
  return {
    eventId,
    recruitmentStatus: event.volunteerRecruitmentStatus,
    targetCount: event.volunteerTargetCount,
    maxHoursPerDay: event.volunteerMaxHours,
    minRestMinutes: event.volunteerMinRestMinutes,
    questions,
    positions,
    requiredTotal: positions.filter((p) => p.status === "active").reduce((a, p) => a + p.requiredTotal, 0),
  };
}

export async function getVolunteering(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<VolunteeringView> {
  await requirePermission(db, actor, "volunteers.review", { organizationId, eventId });
  return loadVolunteeringUnchecked(db, organizationId, eventId);
}

function keyFor(label: string, index: number): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  const key = base && /^[a-z]/.test(base) ? base : `q_${base || index + 1}`;
  return key.slice(0, 60);
}

export async function updateVolunteering(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  input: VolunteeringSettingsInput,
): Promise<VolunteeringView> {
  await requirePermission(db, actor, "volunteers.schedule", { organizationId, eventId });
  const v = volunteeringSettingsSchema.parse(input);
  return db.transaction(async (tx) => {
    const event = await loadEventRow(tx, organizationId, eventId);
    if (v.recruitmentStatus === "open") {
      if (!["draft", "published"].includes(event.status))
        throw new PreconditionFailedError("Le recrutement ne peut s'ouvrir que sur un événement actif.", {
          code: "event_not_active",
        });
      const positions = await loadEventPositionsUnchecked(tx, organizationId, eventId);
      if (!positions.some((p) => p.status === "active"))
        throw new PreconditionFailedError("Activez au moins un poste avant d'ouvrir le recrutement.", {
          code: "no_positions",
        });
    }
    const patch: Partial<typeof schema.events.$inferInsert> = {};
    if (v.recruitmentStatus !== undefined) patch.volunteerRecruitmentStatus = v.recruitmentStatus;
    if (v.targetCount !== undefined) patch.volunteerTargetCount = v.targetCount;
    if (v.maxHoursPerDay !== undefined) patch.volunteerMaxHours = v.maxHoursPerDay;
    if (v.minRestMinutes !== undefined) patch.volunteerMinRestMinutes = v.minRestMinutes;
    if (Object.keys(patch).length > 0) await tx.update(schema.events).set(patch).where(eq(schema.events.id, eventId));

    if (v.questions !== undefined) {
      let form = (
        await tx
          .select({ id: schema.formDefinitions.id })
          .from(schema.formDefinitions)
          .where(
            and(
              eq(schema.formDefinitions.organizationId, organizationId),
              eq(schema.formDefinitions.eventId, eventId),
              eq(schema.formDefinitions.purpose, FORM_PURPOSE),
            ),
          )
          .limit(1)
      )[0];
      if (!form) {
        const [created] = await tx
          .insert(schema.formDefinitions)
          .values({ organizationId, eventId, purpose: FORM_PURPOSE, title: "Questions aux bénévoles" })
          .returning({ id: schema.formDefinitions.id });
        if (!created) throw new Error("form insert failed");
        form = created;
      }
      // Replace the question set; existing answers keep their field rows by key when unchanged.
      const existing = await tx.select().from(schema.formFields).where(eq(schema.formFields.formId, form.id));
      const keys = new Set<string>();
      const wanted = v.questions.map((q, i) => {
        let key = q.key ?? keyFor(q.label, i);
        while (keys.has(key)) key = `${key.slice(0, 55)}_${i + 1}`;
        keys.add(key);
        return { ...q, key };
      });
      for (const e of existing) {
        if (!keys.has(e.key)) await tx.delete(schema.formFields).where(eq(schema.formFields.id, e.id));
      }
      for (const [position, q] of wanted.entries()) {
        const values = {
          organizationId,
          formId: form.id,
          key: q.key,
          label: q.label,
          helpText: q.helpText ?? null,
          type: q.type,
          required: q.required,
          options: q.options.map((o) => ({ value: keyFor(o, 0), label: o })),
          position,
        };
        const found = existing.find((e) => e.key === q.key);
        if (found) await tx.update(schema.formFields).set(values).where(eq(schema.formFields.id, found.id));
        else await tx.insert(schema.formFields).values(values);
      }
      await tx.update(schema.formDefinitions).set({ isActive: true }).where(eq(schema.formDefinitions.id, form.id));
    }
    await recordAudit(tx, actor, {
      organizationId,
      action: "event.volunteering_updated",
      targetType: "event",
      targetId: eventId,
      metadata: { ...patch, questions: v.questions?.length },
    });
    return loadVolunteeringUnchecked(tx, organizationId, eventId);
  });
}

/* ------------------------------------------------------------------------- */
/* Event positions and shifts                                                 */
/* ------------------------------------------------------------------------- */

export async function activateEventPosition(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  input: EventPositionInput,
): Promise<EventPositionView> {
  await requirePermission(db, actor, "volunteers.schedule", { organizationId, eventId });
  const v = eventPositionSchema.parse(input);
  return db.transaction(async (tx) => {
    await loadEventRow(tx, organizationId, eventId);
    const template = (await loadPositionsUnchecked(tx, organizationId, [v.positionId]))[0];
    if (!template) throw new NotFoundError("Poste", v.positionId);
    if (template.status !== "active")
      throw new PreconditionFailedError("Poste archivé.", { code: "position_archived" });
    const existing = (
      await tx
        .select({ id: schema.eventVolunteerPositions.id })
        .from(schema.eventVolunteerPositions)
        .where(
          and(
            eq(schema.eventVolunteerPositions.eventId, eventId),
            eq(schema.eventVolunteerPositions.positionId, v.positionId),
          ),
        )
        .limit(1)
    )[0];
    let id: string;
    if (existing) {
      await tx
        .update(schema.eventVolunteerPositions)
        .set({ status: "active", briefing: v.briefing ?? null })
        .where(eq(schema.eventVolunteerPositions.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await tx
        .insert(schema.eventVolunteerPositions)
        .values({ organizationId, eventId, positionId: v.positionId, briefing: v.briefing ?? null })
        .returning({ id: schema.eventVolunteerPositions.id });
      if (!row) throw new Error("insert failed");
      id = row.id;
    }
    await recordAudit(tx, actor, {
      organizationId,
      action: "event_volunteer_position.activated",
      targetType: "event_volunteer_position",
      targetId: id,
      metadata: { eventId, positionId: v.positionId },
    });
    const view = (await loadEventPositionsUnchecked(tx, organizationId, eventId)).find((p) => p.id === id);
    if (!view) throw new Error("reload failed");
    return view;
  });
}

export async function updateEventPosition(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  eventPositionId: string,
  input: { briefing?: string | null | undefined },
): Promise<EventPositionView> {
  await requirePermission(db, actor, "volunteers.schedule", { organizationId, eventId });
  const updated = await db
    .update(schema.eventVolunteerPositions)
    .set({ briefing: input.briefing?.trim() || null })
    .where(
      and(
        eq(schema.eventVolunteerPositions.id, eventPositionId),
        eq(schema.eventVolunteerPositions.organizationId, organizationId),
        eq(schema.eventVolunteerPositions.eventId, eventId),
      ),
    )
    .returning({ id: schema.eventVolunteerPositions.id });
  if (updated.length === 0) throw new NotFoundError("Poste de l'événement", eventPositionId);
  const view = (await loadEventPositionsUnchecked(db, organizationId, eventId)).find((p) => p.id === eventPositionId);
  if (!view) throw new Error("reload failed");
  return view;
}

/** Deactivate a position on the event: its shifts are cancelled (never deleted). */
export async function deactivateEventPosition(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  eventPositionId: string,
): Promise<void> {
  await requirePermission(db, actor, "volunteers.schedule", { organizationId, eventId });
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.eventVolunteerPositions)
      .set({ status: "archived" })
      .where(
        and(
          eq(schema.eventVolunteerPositions.id, eventPositionId),
          eq(schema.eventVolunteerPositions.organizationId, organizationId),
          eq(schema.eventVolunteerPositions.eventId, eventId),
        ),
      )
      .returning({ id: schema.eventVolunteerPositions.id });
    if (updated.length === 0) throw new NotFoundError("Poste de l'événement", eventPositionId);
    await tx
      .update(schema.volunteerShifts)
      .set({ status: "cancelled", version: sql`${schema.volunteerShifts.version} + 1` })
      .where(
        and(eq(schema.volunteerShifts.eventPositionId, eventPositionId), eq(schema.volunteerShifts.status, "active")),
      );
    await recordAudit(tx, actor, {
      organizationId,
      action: "event_volunteer_position.deactivated",
      targetType: "event_volunteer_position",
      targetId: eventPositionId,
      metadata: { eventId },
    });
  });
}

function assertShiftWithinEvent(event: { startsAt: Date; endsAt: Date }, shift: { startsAt: Date; endsAt: Date }) {
  const slack = 24 * 3_600_000;
  if (
    shift.startsAt.getTime() < event.startsAt.getTime() - slack ||
    shift.endsAt.getTime() > event.endsAt.getTime() + slack
  ) {
    throw new PreconditionFailedError("Le créneau sort de la fenêtre de l'événement (la veille au lendemain).", {
      code: "shift_outside_event",
    });
  }
}

export async function createShift(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  eventPositionId: string,
  input: ShiftInput,
): Promise<ShiftView> {
  await requirePermission(db, actor, "volunteers.schedule", { organizationId, eventId });
  const v = shiftSchema.parse(input);
  return db.transaction(async (tx) => {
    const event = await loadEventRow(tx, organizationId, eventId);
    const position = (
      await tx
        .select({ id: schema.eventVolunteerPositions.id, status: schema.eventVolunteerPositions.status })
        .from(schema.eventVolunteerPositions)
        .where(
          and(
            eq(schema.eventVolunteerPositions.id, eventPositionId),
            eq(schema.eventVolunteerPositions.organizationId, organizationId),
            eq(schema.eventVolunteerPositions.eventId, eventId),
          ),
        )
        .limit(1)
    )[0];
    if (!position) throw new NotFoundError("Poste de l'événement", eventPositionId);
    if (position.status !== "active")
      throw new PreconditionFailedError("Poste désactivé sur cet événement.", { code: "position_inactive" });
    assertShiftWithinEvent(event, v);
    const [row] = await tx
      .insert(schema.volunteerShifts)
      .values({
        organizationId,
        eventId,
        eventPositionId,
        label: v.label ?? null,
        startsAt: v.startsAt,
        endsAt: v.endsAt,
        requiredCount: v.requiredCount,
        maxCount: v.maxCount ?? v.requiredCount,
        notes: v.notes ?? null,
      })
      .returning();
    if (!row) throw new Error("insert failed");
    await recordAudit(tx, actor, {
      organizationId,
      action: "volunteer_shift.created",
      targetType: "volunteer_shift",
      targetId: row.id,
      metadata: { eventId, eventPositionId, startsAt: v.startsAt, endsAt: v.endsAt, requiredCount: v.requiredCount },
    });
    return {
      id: row.id,
      eventPositionId: row.eventPositionId,
      label: row.label,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      requiredCount: row.requiredCount,
      maxCount: row.maxCount,
      notes: row.notes,
      status: row.status,
      version: row.version,
    };
  });
}

export async function updateShift(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  shiftId: string,
  input: ShiftInput,
): Promise<ShiftView> {
  await requirePermission(db, actor, "volunteers.schedule", { organizationId, eventId });
  const v = shiftSchema.parse(input);
  return db.transaction(async (tx) => {
    const event = await loadEventRow(tx, organizationId, eventId);
    const current = (
      await tx
        .select()
        .from(schema.volunteerShifts)
        .where(
          and(
            eq(schema.volunteerShifts.id, shiftId),
            eq(schema.volunteerShifts.organizationId, organizationId),
            eq(schema.volunteerShifts.eventId, eventId),
          ),
        )
        .limit(1)
    )[0];
    if (!current) throw new NotFoundError("Créneau", shiftId);
    if (current.status !== "active") throw new PreconditionFailedError("Créneau annulé.", { code: "shift_cancelled" });
    assertShiftWithinEvent(event, v);
    const [row] = await tx
      .update(schema.volunteerShifts)
      .set({
        label: v.label ?? null,
        startsAt: v.startsAt,
        endsAt: v.endsAt,
        requiredCount: v.requiredCount,
        maxCount: v.maxCount ?? v.requiredCount,
        notes: v.notes ?? null,
        version: current.version + 1,
      })
      .where(eq(schema.volunteerShifts.id, shiftId))
      .returning();
    if (!row) throw new Error("update failed");
    await recordAudit(tx, actor, {
      organizationId,
      action: "volunteer_shift.updated",
      targetType: "volunteer_shift",
      targetId: shiftId,
      metadata: { eventId, startsAt: v.startsAt, endsAt: v.endsAt, requiredCount: v.requiredCount },
    });
    return {
      id: row.id,
      eventPositionId: row.eventPositionId,
      label: row.label,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      requiredCount: row.requiredCount,
      maxCount: row.maxCount,
      notes: row.notes,
      status: row.status,
      version: row.version,
    };
  });
}

export async function cancelShift(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
  shiftId: string,
): Promise<void> {
  await requirePermission(db, actor, "volunteers.schedule", { organizationId, eventId });
  const updated = await db
    .update(schema.volunteerShifts)
    .set({ status: "cancelled", version: sql`${schema.volunteerShifts.version} + 1` })
    .where(
      and(
        eq(schema.volunteerShifts.id, shiftId),
        eq(schema.volunteerShifts.organizationId, organizationId),
        eq(schema.volunteerShifts.eventId, eventId),
        eq(schema.volunteerShifts.status, "active"),
      ),
    )
    .returning({ id: schema.volunteerShifts.id });
  if (updated.length === 0) throw new NotFoundError("Créneau", shiftId);
  await recordAudit(db, actor, {
    organizationId,
    action: "volunteer_shift.cancelled",
    targetType: "volunteer_shift",
    targetId: shiftId,
    metadata: { eventId },
  });
}

/* ------------------------------------------------------------------------- */
/* Public                                                                     */
/* ------------------------------------------------------------------------- */

export async function getPublicVolunteering(
  db: DbExecutor,
  organizationId: string,
  eventId: string,
): Promise<PublicVolunteering> {
  const event = await loadEventRow(db, organizationId, eventId);
  const [view, skills] = await Promise.all([
    loadVolunteeringUnchecked(db, organizationId, eventId),
    loadSkillsUnchecked(db, organizationId),
  ]);
  const positions = view.positions.filter((p) => p.status === "active");
  let closedReason: string | null = null;
  if (event.status !== "published") closedReason = "Cet événement n'est pas ouvert aux candidatures.";
  else if (view.recruitmentStatus !== "open") closedReason = "Le recrutement des bénévoles n'est pas ouvert.";
  else if (event.endsAt.getTime() < Date.now()) closedReason = "Cet événement est terminé.";
  else if (positions.length === 0) closedReason = "Aucun poste n'est proposé pour l'instant.";
  const usedSkillIds = new Set(positions.flatMap((p) => p.skills.map((s) => s.skillId)));
  return {
    open: closedReason === null,
    closedReason,
    targetCount: view.targetCount,
    positions: positions.map((p) => ({
      id: p.positionId,
      name: p.name,
      teamName: p.teamName,
      description: p.description,
      minAge: p.minAge,
      skills: p.skills.map((s) => ({ skillId: s.skillId, name: s.name, mandatory: s.mandatory })),
      shifts: p.shifts
        .filter((s) => s.status === "active")
        .map((s) => ({ id: s.id, label: s.label, startsAt: s.startsAt, endsAt: s.endsAt })),
    })),
    skills: skills
      .filter((s) => s.status === "active" || usedSkillIds.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, requiresVerification: s.requiresVerification })),
    questions: view.questions,
  };
}
