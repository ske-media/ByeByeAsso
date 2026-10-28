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
import { organizations } from "./identity";

/**
 * VOLUNTEERS domain (phase 5): skills catalogue, teams, position templates, positions activated
 * on an event with shifts, and per-event applications (ranked preferences, availabilities,
 * declared skills, reciprocal buddy invitations). Scheduling tables arrive in phase 6.
 *
 * Invariants in the database:
 * - one live application per e-mail and event (partial unique index);
 * - well-formed shifts (end > start, 0 ≤ required ≤ max) and availabilities (end > start);
 * - ranked preferences are unique per application (position and rank);
 * - every child row carries organization_id and is bound by composite FKs (tenant-safe).
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const SLUG = "'^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'";

export const catalogueStatus = pgEnum("volunteer_catalogue_status", ["active", "archived"]);
export const volunteerShiftStatus = pgEnum("volunteer_shift_status", ["active", "cancelled"]);
export const volunteerApplicationStatus = pgEnum("volunteer_application_status", [
  "submitted",
  "under_review",
  "approved",
  "waitlisted",
  "rejected",
  "assigned",
  "confirmed",
  "withdrawn",
]);
export const availabilityKind = pgEnum("volunteer_availability_kind", ["available", "unavailable"]);
export const skillLevel = pgEnum("volunteer_skill_level", ["beginner", "intermediate", "expert"]);

/* ------------------------------------------------------------------------- */
/* Catalogue (organization level)                                             */
/* ------------------------------------------------------------------------- */

export const skills = pgTable(
  "skills",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Staff must verify the declaration before it counts as a qualification (phase 6 hard constraint). */
    requiresVerification: boolean("requires_verification").notNull().default(false),
    status: catalogueStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("skills_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("skills_org_slug_uq").on(t.organizationId, t.slug),
    check("skills_name_len", sql`char_length(${t.name}) between 2 and 80`),
    check("skills_slug_format", sql`${t.slug} ~ ${sql.raw(SLUG)}`),
  ],
);

export const volunteerTeams = pgTable(
  "volunteer_teams",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Design-token name used for planning swimlanes (lime, lavender, orange, neutral). */
    color: text("color").notNull().default("lavender"),
    position: integer("position").notNull().default(0),
    status: catalogueStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("volunteer_teams_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("volunteer_teams_org_slug_uq").on(t.organizationId, t.slug),
    check("volunteer_teams_name_len", sql`char_length(${t.name}) between 2 and 80`),
    check("volunteer_teams_slug_format", sql`${t.slug} ~ ${sql.raw(SLUG)}`),
  ],
);

/** Position template of the organization (e.g. "Bar", "Accueil"), reused across events. */
export const volunteerPositions = pgTable(
  "volunteer_positions",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Instructions shown to approved volunteers (briefing). */
    instructions: text("instructions"),
    minAge: integer("min_age"),
    position: integer("position").notNull().default(0),
    status: catalogueStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("volunteer_positions_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("volunteer_positions_org_slug_uq").on(t.organizationId, t.slug),
    foreignKey({
      columns: [t.organizationId, t.teamId],
      foreignColumns: [volunteerTeams.organizationId, volunteerTeams.id],
      name: "volunteer_positions_team_fk",
    }).onDelete("restrict"),
    check("volunteer_positions_name_len", sql`char_length(${t.name}) between 2 and 80`),
    check("volunteer_positions_slug_format", sql`${t.slug} ~ ${sql.raw(SLUG)}`),
    check("volunteer_positions_min_age", sql`${t.minAge} is null or ${t.minAge} between 14 and 99`),
  ],
);

export const positionRequiredSkills = pgTable(
  "position_required_skills",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    positionId: uuid("position_id").notNull(),
    skillId: uuid("skill_id").notNull(),
    /** true = hard constraint (phase 6), false = soft preference. */
    mandatory: boolean("mandatory").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.positionId],
      foreignColumns: [volunteerPositions.organizationId, volunteerPositions.id],
      name: "position_required_skills_position_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.skillId],
      foreignColumns: [skills.organizationId, skills.id],
      name: "position_required_skills_skill_fk",
    }).onDelete("cascade"),
    uniqueIndex("position_required_skills_uq").on(t.positionId, t.skillId),
  ],
);

/* ------------------------------------------------------------------------- */
/* Event staffing                                                             */
/* ------------------------------------------------------------------------- */

/** A template position activated on one event, with its own briefing and shifts. */
export const eventVolunteerPositions = pgTable(
  "event_volunteer_positions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    positionId: uuid("position_id").notNull(),
    briefing: text("briefing"),
    status: catalogueStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("event_volunteer_positions_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "event_volunteer_positions_event_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.positionId],
      foreignColumns: [volunteerPositions.organizationId, volunteerPositions.id],
      name: "event_volunteer_positions_position_fk",
    }).onDelete("restrict"),
    uniqueIndex("event_volunteer_positions_uq").on(t.eventId, t.positionId),
  ],
);

export const volunteerShifts = pgTable(
  "volunteer_shifts",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    eventPositionId: uuid("event_position_id").notNull(),
    label: text("label"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    requiredCount: integer("required_count").notNull().default(1),
    maxCount: integer("max_count").notNull().default(1),
    notes: text("notes"),
    status: volunteerShiftStatus("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("volunteer_shifts_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.eventPositionId],
      foreignColumns: [eventVolunteerPositions.organizationId, eventVolunteerPositions.id],
      name: "volunteer_shifts_event_position_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "volunteer_shifts_event_fk",
    }).onDelete("cascade"),
    index("volunteer_shifts_event_idx").on(t.eventId, t.startsAt),
    check("volunteer_shifts_range", sql`${t.endsAt} > ${t.startsAt}`),
    check("volunteer_shifts_counts", sql`${t.requiredCount} >= 0 and ${t.maxCount} >= ${t.requiredCount}`),
    check("volunteer_shifts_max_duration", sql`${t.endsAt} - ${t.startsAt} <= interval '24 hours'`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Applications                                                               */
/* ------------------------------------------------------------------------- */

export const volunteerApplications = pgTable(
  "volunteer_applications",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    number: text("number").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    birthYear: integer("birth_year"),
    motivation: text("motivation"),
    experience: text("experience"),
    /** Free-text optional constraints (mobility, diet, must leave by…). */
    constraints: text("constraints"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    status: volunteerApplicationStatus("status").notNull().default("submitted"),
    /** Communicated to the candidate (rejection), never the internal notes. */
    decisionReason: text("decision_reason"),
    /** Staff-only. Never serialised by public views. */
    internalNotes: text("internal_notes"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    withdrawnAt: ts("withdrawn_at"),
    accessTokenHash: text("access_token_hash").notNull(),
    secretVersion: integer("secret_version").notNull().default(1),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("volunteer_applications_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("volunteer_applications_org_number_uq").on(t.organizationId, t.number),
    uniqueIndex("volunteer_applications_access_token_uq").on(t.accessTokenHash),
    uniqueIndex("volunteer_applications_live_uq")
      .on(t.eventId, t.email)
      .where(sql`${t.status} not in ('rejected', 'withdrawn')`),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "volunteer_applications_event_fk",
    }).onDelete("cascade"),
    index("volunteer_applications_event_status_idx").on(t.eventId, t.status),
    index("volunteer_applications_email_idx").on(t.email),
    index("volunteer_applications_user_idx").on(t.userId),
    check("volunteer_applications_email_lower", sql`${t.email} = lower(${t.email})`),
    check("volunteer_applications_names", sql`char_length(${t.firstName}) >= 1 and char_length(${t.lastName}) >= 1`),
    check("volunteer_applications_birth_year", sql`${t.birthYear} is null or ${t.birthYear} between 1900 and 2030`),
    check("volunteer_applications_rejection", sql`${t.status} <> 'rejected' or ${t.decisionReason} is not null`),
    check("volunteer_applications_version_pos", sql`${t.version} >= 1`),
  ],
);

export const volunteerPositionPreferences = pgTable(
  "volunteer_position_preferences",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    positionId: uuid("position_id").notNull(),
    rank: integer("rank").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.applicationId],
      foreignColumns: [volunteerApplications.organizationId, volunteerApplications.id],
      name: "volunteer_position_preferences_application_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.positionId],
      foreignColumns: [volunteerPositions.organizationId, volunteerPositions.id],
      name: "volunteer_position_preferences_position_fk",
    }).onDelete("cascade"),
    uniqueIndex("volunteer_position_preferences_position_uq").on(t.applicationId, t.positionId),
    uniqueIndex("volunteer_position_preferences_rank_uq").on(t.applicationId, t.rank),
    check("volunteer_position_preferences_rank_pos", sql`${t.rank} >= 1`),
  ],
);

export const volunteerAvailabilities = pgTable(
  "volunteer_availabilities",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    kind: availabilityKind("kind").notNull().default("available"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    note: text("note"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.applicationId],
      foreignColumns: [volunteerApplications.organizationId, volunteerApplications.id],
      name: "volunteer_availabilities_application_fk",
    }).onDelete("cascade"),
    index("volunteer_availabilities_application_idx").on(t.applicationId, t.startsAt),
    check("volunteer_availabilities_range", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const volunteerSkills = pgTable(
  "volunteer_skills",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    skillId: uuid("skill_id").notNull(),
    level: skillLevel("level"),
    /** Set by staff for skills that require verification; declared-only otherwise. */
    verified: boolean("verified").notNull().default(false),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    verifiedAt: ts("verified_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.applicationId],
      foreignColumns: [volunteerApplications.organizationId, volunteerApplications.id],
      name: "volunteer_skills_application_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.skillId],
      foreignColumns: [skills.organizationId, skills.id],
      name: "volunteer_skills_skill_fk",
    }).onDelete("cascade"),
    uniqueIndex("volunteer_skills_uq").on(t.applicationId, t.skillId),
  ],
);

/**
 * Buddy wish: "I'd like to work with <e-mail>". `targetApplicationId` is resolved when that
 * person has a live application on the same event; `reciprocal` when both name each other.
 * Nothing about the target is ever shown to the requester beyond the reciprocity flag.
 */
export const volunteerSocialPreferences = pgTable(
  "volunteer_social_preferences",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    targetEmail: text("target_email").notNull(),
    targetApplicationId: uuid("target_application_id"),
    reciprocal: boolean("reciprocal").notNull().default(false),
    invitedAt: ts("invited_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.applicationId],
      foreignColumns: [volunteerApplications.organizationId, volunteerApplications.id],
      name: "volunteer_social_preferences_application_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.targetApplicationId],
      foreignColumns: [volunteerApplications.organizationId, volunteerApplications.id],
      name: "volunteer_social_preferences_target_fk",
    }).onDelete("set null"),
    uniqueIndex("volunteer_social_preferences_uq").on(t.applicationId, t.targetEmail),
    index("volunteer_social_preferences_target_idx").on(t.targetEmail),
    check("volunteer_social_preferences_email_lower", sql`${t.targetEmail} = lower(${t.targetEmail})`),
  ],
);
