import { sql } from "drizzle-orm";
import {
  boolean,
  char,
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
import { organizations } from "./identity";

/**
 * MEMBERSHIPS domain (phase 4). Memberships belong to the organization, never to an event.
 * Invariants in the database:
 * - one ACTIVE membership per person (e-mail, and user when signed in) and organization;
 * - validity ranges are well-formed; prices are non-negative integers;
 * - validity changes are append-only (no UPDATE path in the domain).
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const membershipPeriodKind = pgEnum("membership_period_kind", ["fixed", "rolling"]);
export const membershipPlanStatus = pgEnum("membership_plan_status", ["active", "archived"]);

export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceMinor: integer("price_minor").notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    periodKind: membershipPeriodKind("period_kind").notNull().default("fixed"),
    /** Fixed period: season bounds. */
    validFrom: ts("valid_from"),
    validUntil: ts("valid_until"),
    /** Rolling period: months from activation. */
    durationMonths: integer("duration_months"),
    requiresReview: boolean("requires_review").notNull().default(false),
    maxMembers: integer("max_members"),
    public: boolean("public").notNull().default(true),
    position: integer("position").notNull().default(0),
    status: membershipPlanStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("membership_plans_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("membership_plans_org_slug_uq").on(t.organizationId, t.slug),
    check("membership_plans_name_len", sql`char_length(${t.name}) between 2 and 120`),
    check("membership_plans_slug_format", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'`),
    check("membership_plans_price_nonneg", sql`${t.priceMinor} >= 0`),
    check("membership_plans_max_members", sql`${t.maxMembers} is null or ${t.maxMembers} >= 1`),
    check(
      "membership_plans_period",
      sql`(${t.periodKind} = 'fixed' and ${t.validFrom} is not null and ${t.validUntil} is not null and ${t.validUntil} > ${t.validFrom}) or (${t.periodKind} = 'rolling' and ${t.durationMonths} between 1 and 60)`,
    ),
  ],
);

export const membershipPlanBenefits = pgTable(
  "membership_plan_benefits",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull(),
    label: text("label").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.planId],
      foreignColumns: [membershipPlans.organizationId, membershipPlans.id],
      name: "membership_plan_benefits_plan_fk",
    }).onDelete("cascade"),
    index("membership_plan_benefits_plan_idx").on(t.planId, t.position),
    check("membership_plan_benefits_label_len", sql`char_length(${t.label}) between 1 and 160`),
  ],
);

export const membershipApplicationStatus = pgEnum("membership_application_status", [
  "submitted",
  "approved",
  "rejected",
  "withdrawn",
]);

export const membershipApplications = pgTable(
  "membership_applications",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    status: membershipApplicationStatus("status").notNull().default("submitted"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    rejectionReason: text("rejection_reason"),
    ...timestamps(),
  },
  (t) => [
    unique("membership_applications_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.planId],
      foreignColumns: [membershipPlans.organizationId, membershipPlans.id],
      name: "membership_applications_plan_fk",
    }).onDelete("restrict"),
    index("membership_applications_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    check("membership_applications_email_lower", sql`${t.email} = lower(${t.email})`),
    check("membership_applications_rejection", sql`${t.status} <> 'rejected' or ${t.rejectionReason} is not null`),
  ],
);

export const membershipStatus = pgEnum("membership_status", [
  "pending",
  "awaiting_payment",
  "active",
  "rejected",
  "suspended",
  "expired",
  "cancelled",
]);

/**
 * Lifecycle (typed state machine in @kroov/domain/memberships):
 * pending → awaiting_payment | active | rejected | cancelled ; awaiting_payment → active | cancelled | rejected ;
 * active ↔ suspended ; active | suspended → expired | cancelled. rejected / expired / cancelled are terminal.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull(),
    applicationId: uuid("application_id"),
    /** M-0001, unique per organization. */
    number: text("number").notNull(),
    memberEmail: text("member_email").notNull(),
    memberFirstName: text("member_first_name").notNull(),
    memberLastName: text("member_last_name").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    status: membershipStatus("status").notNull().default("pending"),
    validFrom: ts("valid_from"),
    validUntil: ts("valid_until"),
    /** Previous membership when this one is a renewal. */
    renewedFrom: uuid("renewed_from"),
    priceMinor: integer("price_minor").notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    accessTokenHash: text("access_token_hash").notNull(),
    secretVersion: integer("secret_version").notNull().default(1),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    activatedAt: ts("activated_at"),
    suspendedAt: ts("suspended_at"),
    expiredAt: ts("expired_at"),
    cancelledAt: ts("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    reminderSentAt: ts("reminder_sent_at"),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("memberships_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("memberships_org_number_uq").on(t.organizationId, t.number),
    uniqueIndex("memberships_access_token_uq").on(t.accessTokenHash),
    uniqueIndex("memberships_active_email_uq").on(t.organizationId, t.memberEmail).where(sql`${t.status} = 'active'`),
    uniqueIndex("memberships_active_user_uq")
      .on(t.organizationId, t.userId)
      .where(sql`${t.status} = 'active' and ${t.userId} is not null`),
    foreignKey({
      columns: [t.organizationId, t.planId],
      foreignColumns: [membershipPlans.organizationId, membershipPlans.id],
      name: "memberships_plan_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.applicationId],
      foreignColumns: [membershipApplications.organizationId, membershipApplications.id],
      name: "memberships_application_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.organizationId, t.renewedFrom],
      foreignColumns: [t.organizationId, t.id],
      name: "memberships_renewed_from_fk",
    }).onDelete("set null"),
    index("memberships_org_status_idx").on(t.organizationId, t.status, t.validUntil),
    index("memberships_email_idx").on(t.memberEmail),
    index("memberships_user_idx").on(t.userId),
    check("memberships_email_lower", sql`${t.memberEmail} = lower(${t.memberEmail})`),
    check(
      "memberships_validity",
      sql`${t.validFrom} is null or ${t.validUntil} is null or ${t.validUntil} > ${t.validFrom}`,
    ),
    check(
      "memberships_active_has_validity",
      sql`${t.status} not in ('active','suspended','expired') or (${t.validFrom} is not null and ${t.validUntil} is not null)`,
    ),
    check("memberships_price_nonneg", sql`${t.priceMinor} >= 0`),
    check("memberships_cancel_reason", sql`${t.status} <> 'cancelled' or ${t.cancellationReason} is not null`),
    check("memberships_version_pos", sql`${t.version} >= 1`),
  ],
);

export const membershipEntitlementKind = pgEnum("membership_entitlement_kind", [
  "member_ticket_eligibility",
  "benefit",
]);

/** Rights derived from an active membership (checked by ticketing for members-only ticket types). */
export const membershipEntitlements = pgTable(
  "membership_entitlements",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    kind: membershipEntitlementKind("kind").notNull(),
    key: text("key").notNull().default("default"),
    validFrom: ts("valid_from").notNull(),
    validUntil: ts("valid_until").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("membership_entitlements_uq").on(t.membershipId, t.kind, t.key),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "membership_entitlements_membership_fk",
    }).onDelete("cascade"),
    check("membership_entitlements_validity", sql`${t.validUntil} > ${t.validFrom}`),
  ],
);

/** Append-only history of validity changes (activation, extension, renewal, expiry). */
export const membershipValidityChanges = pgTable(
  "membership_validity_changes",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    /** activated | extended | renewed | expired | suspended | reactivated | cancelled */
    kind: text("kind").notNull(),
    previousValidFrom: ts("previous_valid_from"),
    previousValidUntil: ts("previous_valid_until"),
    newValidFrom: ts("new_valid_from"),
    newValidUntil: ts("new_valid_until"),
    reason: text("reason"),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "membership_validity_changes_membership_fk",
    }).onDelete("cascade"),
    index("membership_validity_changes_membership_idx").on(t.membershipId, t.createdAt),
    check("membership_validity_changes_kind", sql`${t.kind} ~ '^[a-z_]+$'`),
  ],
);
