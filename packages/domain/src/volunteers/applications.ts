import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { contextHasPermission, loadMemberContext, requirePermission } from "../authorization";
import {
  type Actor,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  newId,
  PreconditionFailedError,
  UnauthenticatedError,
  ValidationError,
} from "../kernel";
import { emitDomainEvent } from "../outbox";
import { deriveToken, hashToken, tokensEqual } from "../ticketing/context";
import {
  type Coverage,
  coverageOf,
  effectiveAvailability,
  eventAvailabilityWindow,
  type Interval,
  totalHours,
  validateRanges,
} from "./availability";
import { loadPositionsUnchecked, loadSkillsUnchecked } from "./catalogue";
import {
  sendBuddyInvitation,
  sendVolunteerApplicationReceived,
  sendVolunteerApproved,
  sendVolunteerRejected,
  sendVolunteerWaitlisted,
  sendVolunteerWithdrawn,
  type VolunteerContext,
} from "./emails";
import {
  type BulkDecisionInput,
  bulkDecisionSchema,
  type CandidateEditableInput,
  candidateEditableSchema,
  type ListApplicationsInput,
  listApplicationsSchema,
  type StaffApplicationPatchInput,
  staffApplicationPatchSchema,
  type VolunteerApplicationInput,
  volunteerApplicationSchema,
} from "./schemas";
import { loadEventPositionsUnchecked, loadQuestionsUnchecked, type QuestionView } from "./staffing";
import {
  CANDIDATE_EDITABLE_STATUSES,
  LIVE_STATUSES,
  type VolunteerApplicationStatus,
  volunteerApplicationStateMachine,
} from "./state-machine";

export const VOLUNTEER_TOKEN_SCOPE = "volunteer-application";

/* ------------------------------------------------------------------------- */
/* views                                                                      */
/* ------------------------------------------------------------------------- */

export interface ApplicationEventSummary {
  id: string;
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  recruitmentStatus: "closed" | "open";
}

export interface PreferenceView {
  rank: number;
  positionId: string;
  positionName: string;
  teamName: string;
  /** Whether the position is still activated on the event. */
  active: boolean;
  /** Mandatory skills of the position and whether the candidate satisfies each (declared + verified when required). */
  requirements: Array<{ skillId: string; name: string; mandatory: boolean; declared: boolean; satisfied: boolean }>;
  eligible: boolean;
}

export interface SkillDeclarationView {
  skillId: string;
  name: string;
  level: "beginner" | "intermediate" | "expert" | null;
  requiresVerification: boolean;
  verified: boolean;
  verifiedAt: Date | null;
}

export interface AvailabilityView {
  id: string;
  kind: "available" | "unavailable";
  startsAt: Date;
  endsAt: Date;
  note: string | null;
}

/** Candidate-facing view: never internal notes, reviewer, nor anything about other people. */
export interface CandidateApplicationView {
  id: string;
  number: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  event: ApplicationEventSummary;
  status: VolunteerApplicationStatus;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  birthYear: number | null;
  motivation: string | null;
  experience: string | null;
  constraints: string | null;
  marketingOptIn: boolean;
  /** Reason given to the candidate (rejection). */
  decisionReason: string | null;
  preferences: PreferenceView[];
  availabilities: AvailabilityView[];
  effectiveHours: number;
  skills: SkillDeclarationView[];
  /** Only the e-mail the candidate typed and whether the wish is mutual. */
  buddies: Array<{ email: string; reciprocal: boolean }>;
  answers: Array<{ key: string; label: string; value: string | number | boolean }>;
  editable: boolean;
  accessToken: string;
  createdAt: Date;
  withdrawnAt: Date | null;
  version: number;
}

/** Staff view adds internal notes, review metadata and the buddy resolution. */
export interface ApplicationView extends Omit<CandidateApplicationView, "accessToken" | "buddies"> {
  internalNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  buddies: Array<{
    email: string;
    reciprocal: boolean;
    /** Resolved live application of the buddy on this event (staff only). */
    targetApplicationId: string | null;
    targetName: string | null;
    targetStatus: VolunteerApplicationStatus | null;
  }>;
  /** Coverage of each active shift of the event by the effective availability. */
  shiftCoverage: Array<{
    shiftId: string;
    positionName: string;
    label: string | null;
    startsAt: Date;
    endsAt: Date;
    coverage: Coverage;
  }>;
}

export interface ApplicationListItem {
  id: string;
  number: string;
  status: VolunteerApplicationStatus;
  firstName: string;
  lastName: string;
  email: string;
  eventId: string;
  eventTitle: string;
  firstChoice: string | null;
  skillsCount: number;
  verifiedSkillsCount: number;
  effectiveHours: number;
  createdAt: Date;
}

export interface ApplicationStats {
  approved: number;
  target: number;
  toReview: number;
  waitlisted: number;
  requiredTotal: number;
}

type AppRow = typeof schema.volunteerApplications.$inferSelect;

/* ------------------------------------------------------------------------- */
/* loading                                                                    */
/* ------------------------------------------------------------------------- */

async function loadRow(db: DbExecutor, applicationId: string): Promise<AppRow> {
  const row = (
    await db
      .select()
      .from(schema.volunteerApplications)
      .where(eq(schema.volunteerApplications.id, applicationId))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("Candidature", applicationId);
  return row;
}

async function lockRow(tx: DbExecutor, applicationId: string): Promise<AppRow> {
  const row = (
    await tx
      .select()
      .from(schema.volunteerApplications)
      .where(eq(schema.volunteerApplications.id, applicationId))
      .for("update")
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("Candidature", applicationId);
  return row;
}

async function loadEventSummary(db: DbExecutor, eventId: string): Promise<ApplicationEventSummary> {
  const e = (await db.select().from(schema.events).where(eq(schema.events.id, eventId)).limit(1))[0];
  if (!e) throw new NotFoundError("Événement", eventId);
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    timezone: e.timezone,
    recruitmentStatus: e.volunteerRecruitmentStatus,
  };
}

async function loadAnswers(
  db: DbExecutor,
  organizationId: string,
  eventId: string,
  applicationId: string,
): Promise<CandidateApplicationView["answers"]> {
  const questions = await loadQuestionsUnchecked(db, organizationId, eventId);
  if (questions.length === 0) return [];
  const submission = (
    await db
      .select({ id: schema.formSubmissions.id })
      .from(schema.formSubmissions)
      .where(
        and(
          eq(schema.formSubmissions.subjectType, "volunteer_application"),
          eq(schema.formSubmissions.subjectId, applicationId),
        ),
      )
      .limit(1)
  )[0];
  if (!submission) return [];
  const answers = await db.select().from(schema.formAnswers).where(eq(schema.formAnswers.submissionId, submission.id));
  return questions
    .map((q) => {
      const a = answers.find((x) => x.fieldId === q.id);
      return a ? { key: q.key, label: q.label, value: a.value as string | number | boolean } : null;
    })
    .filter((x): x is { key: string; label: string; value: string | number | boolean } => x !== null);
}

/** Full staff view (no permission check — callers authorize). */
export async function loadApplicationUnchecked(db: DbExecutor, applicationId: string): Promise<ApplicationView> {
  const a = await loadRow(db, applicationId);
  const org = (
    await db
      .select({ name: schema.organizations.name, slug: schema.organizations.slug })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, a.organizationId))
      .limit(1)
  )[0];
  if (!org) throw new NotFoundError("Organisation", a.organizationId);
  const [event, prefs, avails, declared, social, answers, eventPositions, catalogue] = await Promise.all([
    loadEventSummary(db, a.eventId),
    db
      .select()
      .from(schema.volunteerPositionPreferences)
      .where(eq(schema.volunteerPositionPreferences.applicationId, a.id))
      .orderBy(asc(schema.volunteerPositionPreferences.rank)),
    db
      .select()
      .from(schema.volunteerAvailabilities)
      .where(eq(schema.volunteerAvailabilities.applicationId, a.id))
      .orderBy(asc(schema.volunteerAvailabilities.startsAt)),
    db.select().from(schema.volunteerSkills).where(eq(schema.volunteerSkills.applicationId, a.id)),
    db
      .select()
      .from(schema.volunteerSocialPreferences)
      .where(eq(schema.volunteerSocialPreferences.applicationId, a.id))
      .orderBy(asc(schema.volunteerSocialPreferences.createdAt)),
    loadAnswers(db, a.organizationId, a.eventId, a.id),
    loadEventPositionsUnchecked(db, a.organizationId, a.eventId),
    loadSkillsUnchecked(db, a.organizationId),
  ]);
  const templates = await loadPositionsUnchecked(
    db,
    a.organizationId,
    prefs.map((p) => p.positionId),
  );
  const skillsView: SkillDeclarationView[] = declared
    .map((d) => {
      const s = catalogue.find((x) => x.id === d.skillId);
      if (!s) return null;
      return {
        skillId: s.id,
        name: s.name,
        level: d.level,
        requiresVerification: s.requiresVerification,
        verified: d.verified,
        verifiedAt: d.verifiedAt,
      };
    })
    .filter((x): x is SkillDeclarationView => x !== null)
    .sort((x, y) => x.name.localeCompare(y.name, "fr"));
  const satisfied = (skillId: string, requiresVerification: boolean) => {
    const d = skillsView.find((s) => s.skillId === skillId);
    if (!d) return { declared: false, satisfied: false };
    return { declared: true, satisfied: !requiresVerification || d.verified };
  };
  const preferences: PreferenceView[] = prefs
    .map((p) => {
      const t = templates.find((x) => x.id === p.positionId);
      if (!t) return null;
      const ep = eventPositions.find((x) => x.positionId === p.positionId);
      const requirements = t.skills.map((s) => ({
        skillId: s.skillId,
        name: s.name,
        mandatory: s.mandatory,
        ...satisfied(s.skillId, s.requiresVerification),
      }));
      return {
        rank: p.rank,
        positionId: p.positionId,
        positionName: t.name,
        teamName: t.teamName,
        active: ep?.status === "active",
        requirements,
        eligible: requirements.every((r) => !r.mandatory || r.satisfied),
      };
    })
    .filter((x): x is PreferenceView => x !== null);
  const availabilities: AvailabilityView[] = avails.map((r) => ({
    id: r.id,
    kind: r.kind,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    note: r.note,
  }));
  const effective = effectiveAvailability(avails);
  // Staff resolution by e-mail (live application on the same event), independent of the stored link.
  const targetEmails = social.map((s) => s.targetEmail);
  const targetRows =
    targetEmails.length > 0
      ? await db
          .select({
            id: schema.volunteerApplications.id,
            email: schema.volunteerApplications.email,
            firstName: schema.volunteerApplications.firstName,
            lastName: schema.volunteerApplications.lastName,
            status: schema.volunteerApplications.status,
          })
          .from(schema.volunteerApplications)
          .where(
            and(
              eq(schema.volunteerApplications.eventId, a.eventId),
              inArray(schema.volunteerApplications.email, targetEmails),
              inArray(schema.volunteerApplications.status, LIVE_STATUSES),
            ),
          )
      : [];
  const shiftCoverage = eventPositions
    .filter((p) => p.status === "active")
    .flatMap((p) =>
      p.shifts
        .filter((s) => s.status === "active")
        .map((s) => ({
          shiftId: s.id,
          positionName: p.name,
          label: s.label,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          coverage: coverageOf(effective, { start: s.startsAt.getTime(), end: s.endsAt.getTime() }),
        })),
    )
    .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
  return {
    id: a.id,
    number: a.number,
    organizationId: a.organizationId,
    organizationName: org.name,
    organizationSlug: org.slug,
    event,
    status: a.status,
    email: a.email,
    firstName: a.firstName,
    lastName: a.lastName,
    phone: a.phone,
    birthYear: a.birthYear,
    motivation: a.motivation,
    experience: a.experience,
    constraints: a.constraints,
    marketingOptIn: a.marketingOptIn,
    decisionReason: a.status === "rejected" ? a.decisionReason : null,
    internalNotes: a.internalNotes,
    reviewedBy: a.reviewedBy,
    reviewedAt: a.reviewedAt,
    preferences,
    availabilities,
    effectiveHours: totalHours(effective),
    skills: skillsView,
    buddies: social.map((s) => {
      const t = targetRows.find((r) => r.email === s.targetEmail);
      return {
        email: s.targetEmail,
        reciprocal: s.reciprocal,
        targetApplicationId: t?.id ?? null,
        targetName: t ? `${t.firstName} ${t.lastName}` : null,
        targetStatus: t?.status ?? null,
      };
    }),
    answers,
    shiftCoverage,
    editable: CANDIDATE_EDITABLE_STATUSES.includes(a.status),
    createdAt: a.createdAt,
    withdrawnAt: a.withdrawnAt,
    version: a.version,
  };
}

function toCandidateView(
  ctx: VolunteerContext,
  view: ApplicationView,
  secretVersion: number,
): CandidateApplicationView {
  const { internalNotes: _n, reviewedBy: _rb, reviewedAt: _ra, shiftCoverage: _sc, buddies, ...rest } = view;
  return {
    ...rest,
    buddies: buddies.map((b) => ({ email: b.email, reciprocal: b.reciprocal })),
    accessToken: deriveToken(ctx.credentialSecret, VOLUNTEER_TOKEN_SCOPE, view.id, secretVersion),
  };
}

/* ------------------------------------------------------------------------- */
/* validation helpers                                                         */
/* ------------------------------------------------------------------------- */

interface EventContext {
  organizationId: string;
  eventId: string;
  startsAt: Date;
  endsAt: Date;
  activePositionIds: Set<string>;
  activeSkillIds: Set<string>;
  questions: QuestionView[];
}

async function loadEventContext(tx: DbExecutor, organizationId: string, eventId: string): Promise<EventContext> {
  const e = (
    await tx
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.id, eventId), eq(schema.events.organizationId, organizationId)))
      .limit(1)
  )[0];
  if (!e) throw new NotFoundError("Événement", eventId);
  const [positions, skills, questions] = await Promise.all([
    loadEventPositionsUnchecked(tx, organizationId, eventId),
    loadSkillsUnchecked(tx, organizationId),
    loadQuestionsUnchecked(tx, organizationId, eventId),
  ]);
  return {
    organizationId,
    eventId,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    activePositionIds: new Set(positions.filter((p) => p.status === "active").map((p) => p.positionId)),
    activeSkillIds: new Set(skills.map((s) => s.id)),
    questions,
  };
}

function validateEditable(
  ec: EventContext,
  v: {
    positionPreferences?: string[] | undefined;
    availabilities?: Array<{ kind: "available" | "unavailable"; startsAt: Date; endsAt: Date }> | undefined;
    skills?: Array<{ skillId: string }> | undefined;
    buddies?: string[] | undefined;
  },
  ownEmail: string,
  requireComplete: boolean,
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  if (v.positionPreferences !== undefined) {
    const unique = new Set(v.positionPreferences);
    if (unique.size !== v.positionPreferences.length)
      fieldErrors.positionPreferences = ["Un poste ne peut apparaître qu'une fois dans vos vœux."];
    else if (v.positionPreferences.some((id) => !ec.activePositionIds.has(id)))
      fieldErrors.positionPreferences = ["Un des postes choisis n'est pas proposé sur cet événement."];
    else if (requireComplete && v.positionPreferences.length === 0)
      fieldErrors.positionPreferences = ["Choisissez au moins un poste."];
  } else if (requireComplete) fieldErrors.positionPreferences = ["Choisissez au moins un poste."];
  if (v.availabilities !== undefined) {
    const errors = validateRanges(v.availabilities, eventAvailabilityWindow(ec));
    if (errors.length > 0) fieldErrors.availabilities = errors;
    else if (effectiveAvailability(v.availabilities).length === 0)
      fieldErrors.availabilities = ["Indiquez au moins une plage où vous êtes disponible."];
  } else if (requireComplete) fieldErrors.availabilities = ["Indiquez au moins une plage de disponibilité."];
  if (v.skills?.some((s) => !ec.activeSkillIds.has(s.skillId)))
    fieldErrors.skills = ["Une des compétences n'existe pas dans cette organisation."];
  if (v.buddies?.some((b) => b === ownEmail)) fieldErrors.buddies = ["Vous ne pouvez pas être votre propre binôme."];
  if (v.buddies && new Set(v.buddies).size !== v.buddies.length)
    fieldErrors.buddies = ["Une même adresse figure deux fois."];
  return fieldErrors;
}

function assertValid(...errorSets: Array<Record<string, string[]>>): void {
  const merged = Object.assign({}, ...errorSets) as Record<string, string[]>;
  if (Object.keys(merged).length > 0) throw new ValidationError(merged);
}

function validateAnswers(
  questions: QuestionView[],
  answers: Record<string, string | number | boolean> | undefined,
): { answers: Array<{ fieldId: string; value: string | number | boolean }>; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  const out: Array<{ fieldId: string; value: string | number | boolean }> = [];
  for (const q of questions) {
    const raw = answers?.[q.key];
    const empty = raw === undefined || raw === "" || raw === false;
    if (q.required && empty) {
      fieldErrors[`answers.${q.key}`] = ["Cette réponse est obligatoire."];
      continue;
    }
    if (empty) continue;
    if (q.type === "checkbox") {
      if (typeof raw !== "boolean") fieldErrors[`answers.${q.key}`] = ["Réponse attendue : oui ou non."];
      else out.push({ fieldId: q.id, value: raw });
    } else if (q.type === "single_choice") {
      if (typeof raw !== "string" || !q.options.includes(raw))
        fieldErrors[`answers.${q.key}`] = ["Choisissez une des options proposées."];
      else out.push({ fieldId: q.id, value: raw });
    } else {
      const text = String(raw).trim();
      if (text.length > 2000) fieldErrors[`answers.${q.key}`] = ["Réponse trop longue (2 000 caractères max.)."];
      else out.push({ fieldId: q.id, value: text });
    }
  }
  return { answers: out, fieldErrors };
}

async function nextNumber(tx: DbExecutor, organizationId: string): Promise<string> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.volunteerApplications)
    .where(eq(schema.volunteerApplications.organizationId, organizationId));
  return `B-${String(1 + (rows[0]?.n ?? 0)).padStart(4, "0")}`;
}

/* ------------------------------------------------------------------------- */
/* child rows                                                                 */
/* ------------------------------------------------------------------------- */

async function savePreferences(tx: DbExecutor, a: AppRow, positionIds: string[]): Promise<void> {
  await tx
    .delete(schema.volunteerPositionPreferences)
    .where(eq(schema.volunteerPositionPreferences.applicationId, a.id));
  if (positionIds.length > 0) {
    await tx.insert(schema.volunteerPositionPreferences).values(
      positionIds.map((positionId, i) => ({
        organizationId: a.organizationId,
        applicationId: a.id,
        positionId,
        rank: i + 1,
      })),
    );
  }
}

async function saveAvailabilities(
  tx: DbExecutor,
  a: AppRow,
  ranges: Array<{ kind: "available" | "unavailable"; startsAt: Date; endsAt: Date; note?: string | undefined }>,
): Promise<void> {
  await tx.delete(schema.volunteerAvailabilities).where(eq(schema.volunteerAvailabilities.applicationId, a.id));
  if (ranges.length > 0) {
    await tx.insert(schema.volunteerAvailabilities).values(
      ranges.map((r) => ({
        organizationId: a.organizationId,
        applicationId: a.id,
        kind: r.kind,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        note: r.note ?? null,
      })),
    );
  }
}

/** Replace declared skills; verification flags survive for skills that stay declared. */
async function saveSkills(
  tx: DbExecutor,
  a: AppRow,
  declared: Array<{ skillId: string; level?: "beginner" | "intermediate" | "expert" | undefined }>,
): Promise<void> {
  const existing = await tx.select().from(schema.volunteerSkills).where(eq(schema.volunteerSkills.applicationId, a.id));
  const wanted = new Map(declared.map((d) => [d.skillId, d]));
  for (const e of existing) {
    if (!wanted.has(e.skillId)) await tx.delete(schema.volunteerSkills).where(eq(schema.volunteerSkills.id, e.id));
  }
  for (const [skillId, d] of wanted) {
    const found = existing.find((e) => e.skillId === skillId);
    if (found)
      await tx
        .update(schema.volunteerSkills)
        .set({ level: d.level ?? null })
        .where(eq(schema.volunteerSkills.id, found.id));
    else
      await tx
        .insert(schema.volunteerSkills)
        .values({ organizationId: a.organizationId, applicationId: a.id, skillId, level: d.level ?? null });
  }
}

/**
 * Replace buddy wishes and resolve reciprocity in both directions. Returns the e-mails that
 * have no live application on the event (to invite) — never exposed to the candidate.
 */
async function saveBuddies(tx: DbExecutor, a: AppRow, emails: string[]): Promise<string[]> {
  const normalized = [...new Set(emails.map((e) => e.toLowerCase()))];
  // Reset links pointing at us from previous wishes we drop.
  const previous = await tx
    .select()
    .from(schema.volunteerSocialPreferences)
    .where(eq(schema.volunteerSocialPreferences.applicationId, a.id));
  for (const p of previous) {
    if (!normalized.includes(p.targetEmail)) {
      await tx.delete(schema.volunteerSocialPreferences).where(eq(schema.volunteerSocialPreferences.id, p.id));
      if (p.targetApplicationId) {
        await tx
          .update(schema.volunteerSocialPreferences)
          .set({ reciprocal: false })
          .where(
            and(
              eq(schema.volunteerSocialPreferences.applicationId, p.targetApplicationId),
              eq(schema.volunteerSocialPreferences.targetEmail, a.email),
            ),
          );
      }
    }
  }
  const toInvite: string[] = [];
  for (const email of normalized) {
    const target = (
      await tx
        .select({ id: schema.volunteerApplications.id })
        .from(schema.volunteerApplications)
        .where(
          and(
            eq(schema.volunteerApplications.eventId, a.eventId),
            eq(schema.volunteerApplications.email, email),
            inArray(schema.volunteerApplications.status, LIVE_STATUSES),
          ),
        )
        .limit(1)
    )[0];
    let reciprocal = false;
    if (target) {
      const back = (
        await tx
          .select({ id: schema.volunteerSocialPreferences.id })
          .from(schema.volunteerSocialPreferences)
          .where(
            and(
              eq(schema.volunteerSocialPreferences.applicationId, target.id),
              eq(schema.volunteerSocialPreferences.targetEmail, a.email),
            ),
          )
          .limit(1)
      )[0];
      reciprocal = Boolean(back);
      if (back)
        await tx
          .update(schema.volunteerSocialPreferences)
          .set({ reciprocal: true, targetApplicationId: a.id })
          .where(eq(schema.volunteerSocialPreferences.id, back.id));
    } else toInvite.push(email);
    const existing = previous.find((p) => p.targetEmail === email);
    if (existing) {
      await tx
        .update(schema.volunteerSocialPreferences)
        .set({ targetApplicationId: target?.id ?? null, reciprocal })
        .where(eq(schema.volunteerSocialPreferences.id, existing.id));
    } else {
      await tx.insert(schema.volunteerSocialPreferences).values({
        organizationId: a.organizationId,
        applicationId: a.id,
        targetEmail: email,
        targetApplicationId: target?.id ?? null,
        reciprocal,
      });
    }
  }
  return toInvite.filter((email) => !previous.some((p) => p.targetEmail === email && p.invitedAt));
}

async function saveAnswers(
  tx: DbExecutor,
  a: AppRow,
  answers: Array<{ fieldId: string; value: string | number | boolean }>,
  questions: QuestionView[],
  submittedBy: string | null,
): Promise<void> {
  if (questions.length === 0) return;
  const form = (
    await tx
      .select({ id: schema.formDefinitions.id })
      .from(schema.formDefinitions)
      .where(
        and(
          eq(schema.formDefinitions.organizationId, a.organizationId),
          eq(schema.formDefinitions.eventId, a.eventId),
          eq(schema.formDefinitions.purpose, "volunteer_application"),
        ),
      )
      .limit(1)
  )[0];
  if (!form) return;
  const [submission] = await tx
    .insert(schema.formSubmissions)
    .values({
      organizationId: a.organizationId,
      formId: form.id,
      subjectType: "volunteer_application",
      subjectId: a.id,
      submittedBy,
    })
    .returning({ id: schema.formSubmissions.id });
  if (!submission || answers.length === 0) return;
  await tx
    .insert(schema.formAnswers)
    .values(answers.map((x) => ({ submissionId: submission.id, fieldId: x.fieldId, value: x.value })));
}

/* ------------------------------------------------------------------------- */
/* public: apply, read, update, withdraw                                      */
/* ------------------------------------------------------------------------- */

export async function applyAsVolunteer(
  db: Database,
  ctx: VolunteerContext,
  actor: Actor,
  organizationSlug: string,
  eventSlug: string,
  input: VolunteerApplicationInput,
  now = new Date(),
): Promise<CandidateApplicationView> {
  const v = volunteerApplicationSchema.parse(input);
  const result = await db.transaction(async (tx) => {
    const org = (
      await tx
        .select({ id: schema.organizations.id, status: schema.organizations.status })
        .from(schema.organizations)
        .where(eq(schema.organizations.slug, organizationSlug))
        .limit(1)
    )[0];
    if (org?.status !== "active") throw new NotFoundError("Organisation", organizationSlug);
    const event = (
      await tx
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.organizationId, org.id), eq(schema.events.slug, eventSlug)))
        .for("update")
        .limit(1)
    )[0];
    if (event?.status !== "published" || !["public", "unlisted"].includes(event.visibility))
      throw new NotFoundError("Événement", eventSlug);
    if (event.volunteerRecruitmentStatus !== "open" || event.endsAt.getTime() < now.getTime())
      throw new PreconditionFailedError("Le recrutement des bénévoles n'est pas ouvert.", {
        code: "recruitment_closed",
      });
    const ec = await loadEventContext(tx, org.id, event.id);
    const checked = validateAnswers(ec.questions, v.answers);
    assertValid(validateEditable(ec, v, v.email, true), checked.fieldErrors);
    const answers = checked.answers;
    const live = (
      await tx
        .select({ id: schema.volunteerApplications.id })
        .from(schema.volunteerApplications)
        .where(
          and(
            eq(schema.volunteerApplications.eventId, event.id),
            eq(schema.volunteerApplications.email, v.email),
            inArray(schema.volunteerApplications.status, LIVE_STATUSES),
          ),
        )
        .limit(1)
    )[0];
    if (live)
      throw new ConflictError("Une candidature est déjà en cours pour cette adresse : consultez l'e-mail reçu.", {
        code: "application_exists",
      });
    const id = newId();
    const accessToken = deriveToken(ctx.credentialSecret, VOLUNTEER_TOKEN_SCOPE, id, 1);
    const [row] = await tx
      .insert(schema.volunteerApplications)
      .values({
        id,
        organizationId: org.id,
        eventId: event.id,
        number: await nextNumber(tx, org.id),
        email: v.email,
        firstName: v.firstName,
        lastName: v.lastName,
        phone: v.phone ?? null,
        userId: actor.kind === "user" ? actor.userId : null,
        birthYear: v.birthYear ?? null,
        motivation: v.motivation ?? null,
        experience: v.experience ?? null,
        constraints: v.constraints ?? null,
        marketingOptIn: v.marketingOptIn ?? false,
        accessTokenHash: hashToken(accessToken),
        createdAt: now,
      })
      .returning();
    if (!row) throw new Error("insert failed");
    await savePreferences(tx, row, v.positionPreferences ?? []);
    await saveAvailabilities(tx, row, v.availabilities ?? []);
    await saveSkills(tx, row, v.skills ?? []);
    const toInvite = await saveBuddies(tx, row, v.buddies ?? []);
    if (toInvite.length > 0)
      await tx
        .update(schema.volunteerSocialPreferences)
        .set({ invitedAt: now })
        .where(
          and(
            eq(schema.volunteerSocialPreferences.applicationId, row.id),
            inArray(schema.volunteerSocialPreferences.targetEmail, toInvite),
          ),
        );
    await saveAnswers(tx, row, answers, ec.questions, actor.kind === "user" ? actor.userId : null);
    await recordAudit(tx, actor, {
      organizationId: org.id,
      action: "volunteer_application.submitted",
      targetType: "volunteer_application",
      targetId: row.id,
      metadata: { eventId: event.id, number: row.number, preferences: v.positionPreferences?.length ?? 0 },
    });
    await emitDomainEvent(tx, {
      aggregateType: "volunteer_application",
      aggregateId: row.id,
      eventType: "volunteer_application.submitted",
      organizationId: org.id,
      payload: { eventId: event.id, email: v.email },
    });
    return { id: row.id, toInvite, applyUrl: `${ctx.appUrl}/${organizationSlug}/${eventSlug}/benevoles` };
  });
  const view = toCandidateView(ctx, await loadApplicationUnchecked(db, result.id), 1);
  await sendVolunteerApplicationReceived(ctx, view).catch(() => undefined);
  for (const email of result.toInvite) {
    await sendBuddyInvitation(ctx, email, `${view.firstName} ${view.lastName}`, view, result.applyUrl).catch(
      () => undefined,
    );
  }
  return view;
}

export interface CandidateAuth {
  accessToken?: string | null | undefined;
  actor?: Actor | undefined;
  email?: string | undefined;
}

async function authorizeCandidate(db: DbExecutor, applicationId: string, auth: CandidateAuth): Promise<AppRow> {
  const row = await loadRow(db, applicationId);
  const byToken = auth.accessToken ? tokensEqual(hashToken(auth.accessToken), row.accessTokenHash) : false;
  const byUser =
    auth.actor?.kind === "user" &&
    ((row.userId !== null && row.userId === auth.actor.userId) ||
      (auth.email !== undefined && auth.email.toLowerCase() === row.email));
  if (!byToken && !byUser) throw new NotFoundError("Candidature", applicationId);
  return row;
}

export async function getApplicationForCandidate(
  db: DbExecutor,
  ctx: VolunteerContext,
  applicationId: string,
  auth: CandidateAuth,
): Promise<CandidateApplicationView> {
  const row = await authorizeCandidate(db, applicationId, auth);
  return toCandidateView(ctx, await loadApplicationUnchecked(db, row.id), row.secretVersion);
}

export async function updateApplicationByCandidate(
  db: Database,
  ctx: VolunteerContext,
  applicationId: string,
  auth: CandidateAuth,
  input: CandidateEditableInput,
  now = new Date(),
): Promise<CandidateApplicationView> {
  const v = candidateEditableSchema.parse(input);
  await authorizeCandidate(db, applicationId, auth);
  const result = await db.transaction(async (tx) => {
    const a = await lockRow(tx, applicationId);
    if (!CANDIDATE_EDITABLE_STATUSES.includes(a.status))
      throw new PreconditionFailedError("Cette candidature ne peut plus être modifiée.", {
        code: "not_editable",
        status: a.status,
      });
    const ec = await loadEventContext(tx, a.organizationId, a.eventId);
    assertValid(
      validateEditable(ec, v, a.email, false),
      v.positionPreferences !== undefined && v.positionPreferences.length === 0
        ? { positionPreferences: ["Choisissez au moins un poste."] }
        : {},
    );
    if (v.positionPreferences) await savePreferences(tx, a, v.positionPreferences);
    if (v.availabilities) await saveAvailabilities(tx, a, v.availabilities);
    if (v.skills) await saveSkills(tx, a, v.skills);
    let toInvite: string[] = [];
    if (v.buddies) {
      toInvite = await saveBuddies(tx, a, v.buddies);
      if (toInvite.length > 0)
        await tx
          .update(schema.volunteerSocialPreferences)
          .set({ invitedAt: now })
          .where(
            and(
              eq(schema.volunteerSocialPreferences.applicationId, a.id),
              inArray(schema.volunteerSocialPreferences.targetEmail, toInvite),
            ),
          );
    }
    const patch: Partial<typeof schema.volunteerApplications.$inferInsert> = { version: a.version + 1 };
    if (v.constraints !== undefined) patch.constraints = v.constraints ?? null;
    if (v.phone !== undefined) patch.phone = v.phone ?? null;
    await tx.update(schema.volunteerApplications).set(patch).where(eq(schema.volunteerApplications.id, a.id));
    await recordAudit(
      tx,
      { kind: "anonymous" },
      {
        organizationId: a.organizationId,
        action: "volunteer_application.updated_by_candidate",
        targetType: "volunteer_application",
        targetId: a.id,
        metadata: { fields: Object.keys(v) },
      },
    );
    return { a, toInvite };
  });
  const view = toCandidateView(ctx, await loadApplicationUnchecked(db, applicationId), result.a.secretVersion);
  for (const email of result.toInvite) {
    await sendBuddyInvitation(
      ctx,
      email,
      `${view.firstName} ${view.lastName}`,
      view,
      `${ctx.appUrl}/${view.organizationSlug}/${view.event.slug}/benevoles`,
    ).catch(() => undefined);
  }
  return view;
}

export async function withdrawApplication(
  db: Database,
  ctx: VolunteerContext,
  applicationId: string,
  auth: CandidateAuth,
  reason: string | undefined,
  now = new Date(),
): Promise<CandidateApplicationView> {
  await authorizeCandidate(db, applicationId, auth);
  const secretVersion = await db.transaction(async (tx) => {
    const a = await lockRow(tx, applicationId);
    volunteerApplicationStateMachine.transition(a.status, "withdrawn", {
      actor: "candidate",
      now,
      ...(reason ? { reason } : {}),
    });
    await tx
      .update(schema.volunteerApplications)
      .set({ status: "withdrawn", withdrawnAt: now, decisionReason: reason ?? null, version: a.version + 1 })
      .where(eq(schema.volunteerApplications.id, a.id));
    // A withdrawn candidate no longer counts as a buddy target, in either direction.
    await tx
      .update(schema.volunteerSocialPreferences)
      .set({ reciprocal: false, targetApplicationId: null })
      .where(eq(schema.volunteerSocialPreferences.targetApplicationId, a.id));
    await tx
      .update(schema.volunteerSocialPreferences)
      .set({ reciprocal: false })
      .where(eq(schema.volunteerSocialPreferences.applicationId, a.id));
    await recordAudit(tx, auth.actor ?? { kind: "anonymous" }, {
      organizationId: a.organizationId,
      action: "volunteer_application.withdrawn",
      targetType: "volunteer_application",
      targetId: a.id,
      metadata: { from: a.status, reason: reason ?? null },
    });
    await emitDomainEvent(tx, {
      aggregateType: "volunteer_application",
      aggregateId: a.id,
      eventType: "volunteer_application.withdrawn",
      organizationId: a.organizationId,
      payload: { eventId: a.eventId, previousStatus: a.status },
    });
    return a.secretVersion;
  });
  const view = toCandidateView(ctx, await loadApplicationUnchecked(db, applicationId), secretVersion);
  await sendVolunteerWithdrawn(ctx, view).catch(() => undefined);
  return view;
}

export async function listMyApplications(
  db: DbExecutor,
  ctx: VolunteerContext,
  actor: Actor,
  email: string,
): Promise<CandidateApplicationView[]> {
  if (actor.kind !== "user") throw new ForbiddenError("user");
  const rows = await db
    .select({ id: schema.volunteerApplications.id, v: schema.volunteerApplications.secretVersion })
    .from(schema.volunteerApplications)
    .where(
      or(
        eq(schema.volunteerApplications.userId, actor.userId),
        eq(schema.volunteerApplications.email, email.toLowerCase()),
      ),
    )
    .orderBy(desc(schema.volunteerApplications.createdAt))
    .limit(50);
  const out: CandidateApplicationView[] = [];
  for (const r of rows) out.push(toCandidateView(ctx, await loadApplicationUnchecked(db, r.id), r.v));
  return out;
}

/* ------------------------------------------------------------------------- */
/* organizer: list, stats, detail, edit                                       */
/* ------------------------------------------------------------------------- */

/** Event ids the actor may review in the organization, or null for the whole organization. */
async function reviewScope(db: DbExecutor, actor: Actor, organizationId: string): Promise<string[] | null> {
  if (actor.kind === "anonymous") throw new UnauthenticatedError();
  if (actor.kind !== "user") return null;
  const member = await loadMemberContext(db, actor.userId, organizationId);
  if (!member) throw new ForbiddenError("volunteers.review");
  if (contextHasPermission(member, "volunteers.review", { organizationId })) return null;
  const events = [...member.eventPermissions.entries()]
    .filter(([, perms]) => perms.has("volunteers.review"))
    .map(([eventId]) => eventId);
  if (events.length === 0) throw new ForbiddenError("volunteers.review");
  return events;
}

export async function listApplications(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  input: ListApplicationsInput = {},
): Promise<ApplicationListItem[]> {
  const v = listApplicationsSchema.parse(input);
  const scope = await reviewScope(db, actor, organizationId);
  if (v.eventId && scope && !scope.includes(v.eventId)) throw new ForbiddenError("volunteers.review");
  const conditions = [eq(schema.volunteerApplications.organizationId, organizationId)];
  if (v.eventId) conditions.push(eq(schema.volunteerApplications.eventId, v.eventId));
  else if (scope) conditions.push(inArray(schema.volunteerApplications.eventId, scope));
  if (v.status === "to_review")
    conditions.push(inArray(schema.volunteerApplications.status, ["submitted", "under_review"]));
  else if (v.status !== "all") conditions.push(eq(schema.volunteerApplications.status, v.status));
  if (v.positionId)
    conditions.push(
      sql`exists (select 1 from ${schema.volunteerPositionPreferences} p where p.application_id = "volunteer_applications"."id" and p.position_id = ${v.positionId})`,
    );
  if (v.skillId)
    conditions.push(
      sql`exists (select 1 from ${schema.volunteerSkills} s where s.application_id = "volunteer_applications"."id" and s.skill_id = ${v.skillId})`,
    );
  if (v.q) {
    const q = `%${v.q}%`;
    conditions.push(
      or(
        ilike(schema.volunteerApplications.number, q),
        ilike(schema.volunteerApplications.email, q),
        ilike(schema.volunteerApplications.firstName, q),
        ilike(schema.volunteerApplications.lastName, q),
      ) ?? sql`true`,
    );
  }
  const rows = await db
    .select({
      a: schema.volunteerApplications,
      eventTitle: schema.events.title,
      firstChoice: sql<
        string | null
      >`(select vp.name from ${schema.volunteerPositionPreferences} p join ${schema.volunteerPositions} vp on vp.id = p.position_id where p.application_id = "volunteer_applications"."id" order by p.rank asc limit 1)`,
      skillsCount: sql<number>`(select count(*)::int from ${schema.volunteerSkills} s where s.application_id = "volunteer_applications"."id")`,
      verifiedSkillsCount: sql<number>`(select count(*)::int from ${schema.volunteerSkills} s where s.application_id = "volunteer_applications"."id" and s.verified)`,
    })
    .from(schema.volunteerApplications)
    .innerJoin(schema.events, eq(schema.events.id, schema.volunteerApplications.eventId))
    .where(and(...conditions))
    .orderBy(desc(schema.volunteerApplications.createdAt))
    .limit(500);
  if (rows.length === 0) return [];
  const avails = await db
    .select()
    .from(schema.volunteerAvailabilities)
    .where(
      inArray(
        schema.volunteerAvailabilities.applicationId,
        rows.map((r) => r.a.id),
      ),
    );
  return rows.map((r) => ({
    id: r.a.id,
    number: r.a.number,
    status: r.a.status,
    firstName: r.a.firstName,
    lastName: r.a.lastName,
    email: r.a.email,
    eventId: r.a.eventId,
    eventTitle: r.eventTitle,
    firstChoice: r.firstChoice,
    skillsCount: r.skillsCount,
    verifiedSkillsCount: r.verifiedSkillsCount,
    effectiveHours: totalHours(effectiveAvailability(avails.filter((x) => x.applicationId === r.a.id))),
    createdAt: r.a.createdAt,
  }));
}

export async function applicationStats(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId?: string,
): Promise<ApplicationStats> {
  const scope = await reviewScope(db, actor, organizationId);
  if (eventId && scope && !scope.includes(eventId)) throw new ForbiddenError("volunteers.review");
  const conditions = [eq(schema.volunteerApplications.organizationId, organizationId)];
  if (eventId) conditions.push(eq(schema.volunteerApplications.eventId, eventId));
  else if (scope) conditions.push(inArray(schema.volunteerApplications.eventId, scope));
  const rows = await db
    .select({ status: schema.volunteerApplications.status, n: sql<number>`count(*)::int` })
    .from(schema.volunteerApplications)
    .where(and(...conditions))
    .groupBy(schema.volunteerApplications.status);
  const count = (s: VolunteerApplicationStatus) => rows.find((r) => r.status === s)?.n ?? 0;
  const eventConditions = [
    eq(schema.events.organizationId, organizationId),
    inArray(schema.events.status, ["draft", "published"]),
  ];
  if (eventId) eventConditions.push(eq(schema.events.id, eventId));
  else if (scope) eventConditions.push(inArray(schema.events.id, scope));
  const targets = await db
    .select({
      target: sql<number>`coalesce(sum(${schema.events.volunteerTargetCount}), 0)::int`,
      required: sql<number>`coalesce((select sum(s.required_count) from ${schema.volunteerShifts} s join ${schema.events} e2 on e2.id = s.event_id where s.status = 'active' and e2.organization_id = ${organizationId} ${eventId ? sql`and e2.id = ${eventId}` : sql``}), 0)::int`,
    })
    .from(schema.events)
    .where(and(...eventConditions));
  return {
    approved: count("approved") + count("assigned") + count("confirmed"),
    target: targets[0]?.target ?? 0,
    toReview: count("submitted") + count("under_review"),
    waitlisted: count("waitlisted"),
    requiredTotal: targets[0]?.required ?? 0,
  };
}

async function authorizeStaff(db: DbExecutor, actor: Actor, organizationId: string, applicationId: string) {
  const row = (
    await db
      .select({ eventId: schema.volunteerApplications.eventId })
      .from(schema.volunteerApplications)
      .where(
        and(
          eq(schema.volunteerApplications.id, applicationId),
          eq(schema.volunteerApplications.organizationId, organizationId),
        ),
      )
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("Candidature", applicationId);
  await requirePermission(db, actor, "volunteers.review", { organizationId, eventId: row.eventId });
}

export async function getApplication(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  applicationId: string,
): Promise<ApplicationView> {
  await authorizeStaff(db, actor, organizationId, applicationId);
  return loadApplicationUnchecked(db, applicationId);
}

/** Staff edit: identity, preferences, availabilities, skills (+ verification), buddies, notes. */
export async function updateApplicationByStaff(
  db: Database,
  actor: Actor,
  organizationId: string,
  applicationId: string,
  input: StaffApplicationPatchInput,
  now = new Date(),
): Promise<ApplicationView> {
  const v = staffApplicationPatchSchema.parse(input);
  await authorizeStaff(db, actor, organizationId, applicationId);
  await db.transaction(async (tx) => {
    const a = await lockRow(tx, applicationId);
    if (["rejected", "withdrawn"].includes(a.status))
      throw new PreconditionFailedError("Candidature close.", { code: "closed", status: a.status });
    const ec = await loadEventContext(tx, organizationId, a.eventId);
    assertValid(validateEditable(ec, v, v.email ?? a.email, false));
    if (v.email && v.email !== a.email) {
      const clash = (
        await tx
          .select({ id: schema.volunteerApplications.id })
          .from(schema.volunteerApplications)
          .where(
            and(
              eq(schema.volunteerApplications.eventId, a.eventId),
              eq(schema.volunteerApplications.email, v.email),
              inArray(schema.volunteerApplications.status, LIVE_STATUSES),
            ),
          )
          .limit(1)
      )[0];
      if (clash)
        throw new ConflictError("Une autre candidature utilise déjà cette adresse.", { code: "application_exists" });
    }
    if (v.positionPreferences) await savePreferences(tx, a, v.positionPreferences);
    if (v.availabilities) await saveAvailabilities(tx, a, v.availabilities);
    if (v.skills) await saveSkills(tx, a, v.skills);
    if (v.buddies) await saveBuddies(tx, a, v.buddies);
    if (v.verifiedSkillIds) {
      const declared = await tx
        .select()
        .from(schema.volunteerSkills)
        .where(eq(schema.volunteerSkills.applicationId, a.id));
      for (const d of declared) {
        const wanted = v.verifiedSkillIds.includes(d.skillId);
        if (wanted !== d.verified)
          await tx
            .update(schema.volunteerSkills)
            .set({
              verified: wanted,
              verifiedBy: wanted && actor.kind === "user" ? actor.userId : null,
              verifiedAt: wanted ? now : null,
            })
            .where(eq(schema.volunteerSkills.id, d.id));
      }
    }
    const patch: Partial<typeof schema.volunteerApplications.$inferInsert> = { version: a.version + 1 };
    if (v.firstName !== undefined) patch.firstName = v.firstName;
    if (v.lastName !== undefined) patch.lastName = v.lastName;
    if (v.email !== undefined) patch.email = v.email;
    if (v.phone !== undefined) patch.phone = v.phone ?? null;
    if (v.constraints !== undefined) patch.constraints = v.constraints ?? null;
    if (v.internalNotes !== undefined) patch.internalNotes = v.internalNotes || null;
    await tx.update(schema.volunteerApplications).set(patch).where(eq(schema.volunteerApplications.id, a.id));
    await recordAudit(tx, actor, {
      organizationId,
      action: "volunteer_application.updated_by_staff",
      targetType: "volunteer_application",
      targetId: a.id,
      metadata: {
        fields: Object.keys(v).filter((k) => k !== "internalNotes"),
        notesChanged: v.internalNotes !== undefined,
      },
    });
  });
  return loadApplicationUnchecked(db, applicationId);
}

export async function verifySkill(
  db: Database,
  actor: Actor,
  organizationId: string,
  applicationId: string,
  skillId: string,
  verified: boolean,
  now = new Date(),
): Promise<ApplicationView> {
  await authorizeStaff(db, actor, organizationId, applicationId);
  const updated = await db
    .update(schema.volunteerSkills)
    .set({
      verified,
      verifiedBy: verified && actor.kind === "user" ? actor.userId : null,
      verifiedAt: verified ? now : null,
    })
    .where(and(eq(schema.volunteerSkills.applicationId, applicationId), eq(schema.volunteerSkills.skillId, skillId)))
    .returning({ id: schema.volunteerSkills.id });
  if (updated.length === 0) throw new NotFoundError("Compétence déclarée", skillId);
  await recordAudit(db, actor, {
    organizationId,
    action: verified ? "volunteer_skill.verified" : "volunteer_skill.unverified",
    targetType: "volunteer_application",
    targetId: applicationId,
    metadata: { skillId },
  });
  return loadApplicationUnchecked(db, applicationId);
}

/* ------------------------------------------------------------------------- */
/* organizer: decisions                                                       */
/* ------------------------------------------------------------------------- */

export type Decision = "review" | "approve" | "waitlist" | "reject";

const DECISION_TARGET: Record<Decision, VolunteerApplicationStatus> = {
  review: "under_review",
  approve: "approved",
  waitlist: "waitlisted",
  reject: "rejected",
};

async function decideInTx(
  tx: DbExecutor,
  actor: Actor,
  organizationId: string,
  applicationId: string,
  decision: Decision,
  reason: string | undefined,
  now: Date,
): Promise<{ from: VolunteerApplicationStatus; to: VolunteerApplicationStatus }> {
  const a = await lockRow(tx, applicationId);
  if (a.organizationId !== organizationId) throw new NotFoundError("Candidature", applicationId);
  const to = DECISION_TARGET[decision];
  if (decision === "reject" && !reason)
    throw new ValidationError({ reason: ["Indiquez le motif communiqué à la personne."] });
  volunteerApplicationStateMachine.transition(a.status, to, { actor: actor.kind, now, ...(reason ? { reason } : {}) });
  await tx
    .update(schema.volunteerApplications)
    .set({
      status: to,
      decisionReason: decision === "reject" ? (reason ?? null) : null,
      reviewedBy: actor.kind === "user" ? actor.userId : null,
      reviewedAt: now,
      version: a.version + 1,
    })
    .where(eq(schema.volunteerApplications.id, a.id));
  if (to === "rejected") {
    await tx
      .update(schema.volunteerSocialPreferences)
      .set({ reciprocal: false, targetApplicationId: null })
      .where(eq(schema.volunteerSocialPreferences.targetApplicationId, a.id));
    await tx
      .update(schema.volunteerSocialPreferences)
      .set({ reciprocal: false })
      .where(eq(schema.volunteerSocialPreferences.applicationId, a.id));
  }
  await recordAudit(tx, actor, {
    organizationId,
    action: `volunteer_application.${to}`,
    targetType: "volunteer_application",
    targetId: a.id,
    metadata: { from: a.status, reason: reason ?? null },
  });
  await emitDomainEvent(tx, {
    aggregateType: "volunteer_application",
    aggregateId: a.id,
    eventType: `volunteer_application.${to}`,
    organizationId,
    payload: { eventId: a.eventId, from: a.status },
  });
  return { from: a.status, to };
}

async function notifyDecision(
  db: DbExecutor,
  ctx: VolunteerContext,
  applicationId: string,
  to: VolunteerApplicationStatus,
  reason: string | undefined,
): Promise<void> {
  if (to === "under_review") return;
  const row = await loadRow(db, applicationId);
  const view = toCandidateView(ctx, await loadApplicationUnchecked(db, applicationId), row.secretVersion);
  if (to === "approved") await sendVolunteerApproved(ctx, view).catch(() => undefined);
  else if (to === "waitlisted") await sendVolunteerWaitlisted(ctx, view).catch(() => undefined);
  else if (to === "rejected") await sendVolunteerRejected(ctx, view, reason ?? "").catch(() => undefined);
}

export async function decideApplication(
  db: Database,
  ctx: VolunteerContext,
  actor: Actor,
  organizationId: string,
  applicationId: string,
  decision: Decision,
  reason?: string,
  now = new Date(),
): Promise<ApplicationView> {
  await authorizeStaff(db, actor, organizationId, applicationId);
  const { to } = await db.transaction((tx) =>
    decideInTx(tx, actor, organizationId, applicationId, decision, reason, now),
  );
  await notifyDecision(db, ctx, applicationId, to, reason);
  return loadApplicationUnchecked(db, applicationId);
}

export interface BulkResult {
  id: string;
  ok: boolean;
  status?: VolunteerApplicationStatus;
  error?: string;
}

/** Bulk decisions: each record is validated and committed on its own; one failure never blocks the others. */
export async function bulkDecide(
  db: Database,
  ctx: VolunteerContext,
  actor: Actor,
  organizationId: string,
  input: BulkDecisionInput,
  now = new Date(),
): Promise<BulkResult[]> {
  const v = bulkDecisionSchema.parse(input);
  const results: BulkResult[] = [];
  for (const id of [...new Set(v.ids)]) {
    try {
      await authorizeStaff(db, actor, organizationId, id);
      const { to } = await db.transaction((tx) => decideInTx(tx, actor, organizationId, id, v.action, v.reason, now));
      await notifyDecision(db, ctx, id, to, v.reason);
      results.push({ id, ok: true, status: to });
    } catch (error) {
      results.push({ id, ok: false, error: error instanceof Error ? error.message : "Erreur inconnue" });
    }
  }
  await recordAudit(db, actor, {
    organizationId,
    action: "volunteer_application.bulk",
    targetType: "volunteer_application",
    metadata: { action: v.action, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length },
  });
  return results;
}

/* ------------------------------------------------------------------------- */
/* organizer: availability matrix                                             */
/* ------------------------------------------------------------------------- */

export interface AvailabilityMatrix {
  shifts: Array<{
    id: string;
    positionName: string;
    label: string | null;
    startsAt: Date;
    endsAt: Date;
    requiredCount: number;
  }>;
  volunteers: Array<{
    id: string;
    name: string;
    status: VolunteerApplicationStatus;
    effectiveHours: number;
    coverage: Record<string, Coverage>;
  }>;
  /** Per shift: number of approved volunteers fully available. */
  availablePerShift: Record<string, number>;
}

export async function availabilityMatrix(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<AvailabilityMatrix> {
  await requirePermission(db, actor, "volunteers.review", { organizationId, eventId });
  const positions = await loadEventPositionsUnchecked(db, organizationId, eventId);
  const shifts = positions
    .filter((p) => p.status === "active")
    .flatMap((p) =>
      p.shifts
        .filter((s) => s.status === "active")
        .map((s) => ({
          id: s.id,
          positionName: p.name,
          label: s.label,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          requiredCount: s.requiredCount,
        })),
    )
    .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
  const apps = await db
    .select()
    .from(schema.volunteerApplications)
    .where(
      and(
        eq(schema.volunteerApplications.organizationId, organizationId),
        eq(schema.volunteerApplications.eventId, eventId),
        inArray(schema.volunteerApplications.status, ["approved", "assigned", "confirmed", "waitlisted"]),
      ),
    )
    .orderBy(asc(schema.volunteerApplications.lastName), asc(schema.volunteerApplications.firstName));
  const avails =
    apps.length > 0
      ? await db
          .select()
          .from(schema.volunteerAvailabilities)
          .where(
            inArray(
              schema.volunteerAvailabilities.applicationId,
              apps.map((a) => a.id),
            ),
          )
      : [];
  const availablePerShift: Record<string, number> = Object.fromEntries(shifts.map((s) => [s.id, 0]));
  const volunteers = apps.map((a) => {
    const effective: Interval[] = effectiveAvailability(avails.filter((x) => x.applicationId === a.id));
    const coverage: Record<string, Coverage> = {};
    for (const s of shifts) {
      const c = coverageOf(effective, { start: s.startsAt.getTime(), end: s.endsAt.getTime() });
      coverage[s.id] = c;
      if (c === "full" && a.status !== "waitlisted") availablePerShift[s.id] = (availablePerShift[s.id] ?? 0) + 1;
    }
    return {
      id: a.id,
      name: `${a.firstName} ${a.lastName}`,
      status: a.status,
      effectiveHours: totalHours(effective),
      coverage,
    };
  });
  return { shifts, volunteers, availablePerShift };
}
