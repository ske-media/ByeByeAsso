import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { users } from "./auth";

/**
 * IDENTITY domain: profiles, organizations (tenants), membership, RBAC, invitations, audit.
 *
 * Tenant safety: every organization-owned row carries `organization_id`; relations between
 * tenant-owned rows use composite FKs `(organization_id, <id>)` so a row can never reference
 * a row of another organization (enforced by PostgreSQL, not only by application code).
 */

/* ------------------------------------------------------------------------- */
/* user_profiles                                                               */
/* ------------------------------------------------------------------------- */

/** Application-level profile, 1:1 with Better Auth `users`. Retention: deleted with the user. */
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    locale: text("locale").notNull().default("fr-FR"),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    phone: text("phone"),
    ...timestamps(),
  },
  (t) => [check("user_profiles_locale_format", sql`${t.locale} ~ '^[a-z]{2}(-[A-Z]{2})?$'`)],
);

/* ------------------------------------------------------------------------- */
/* organizations                                                               */
/* ------------------------------------------------------------------------- */

export const organizationLegalForm = pgEnum("organization_legal_form", [
  "association",
  "company",
  "collective",
  "public_body",
  "other",
]);

export const organizationStatus = pgEnum("organization_status", ["active", "suspended", "archived"]);

/**
 * Tenant root. `slug` is the public identifier used in URLs (/o/{slug}, /{slug}/events…).
 * Lifecycle: active → suspended (platform decision) → active ; active → archived (owner).
 * Retention: archived organizations are kept (financial history), never hard-deleted in MVP.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    legalForm: organizationLegalForm("legal_form").notNull().default("association"),
    country: char("country", { length: 2 }).notNull().default("FR"),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    status: organizationStatus("status").notNull().default("active"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("organizations_slug_uq").on(t.slug),
    check("organizations_slug_format", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'`),
    check("organizations_name_len", sql`char_length(${t.name}) between 2 and 120`),
    check("organizations_country_upper", sql`${t.country} ~ '^[A-Z]{2}$'`),
  ],
);

/** 1:1 settings. Policies (fees, holds, rest rules) will be added by the phases that need them. */
export const organizationSettings = pgTable(
  "organization_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    locale: text("locale").notNull().default("fr-FR"),
    contactEmail: text("contact_email"),
    website: text("website"),
    ...timestamps(),
  },
  (t) => [check("organization_settings_currency_upper", sql`${t.currency} ~ '^[A-Z]{3}$'`)],
);

/* ------------------------------------------------------------------------- */
/* organization_members                                                        */
/* ------------------------------------------------------------------------- */

export const memberStatus = pgEnum("member_status", ["active", "removed"]);

/**
 * Membership of a user in an organization. One ACTIVE membership per (organization, user).
 * A removed membership is kept for audit; re-inviting creates a new active row.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: memberStatus("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
    removedBy: uuid("removed_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("organization_members_active_uq").on(t.organizationId, t.userId).where(sql`${t.status} = 'active'`),
    // Composite target for tenant-safe FKs from other tables.
    unique("organization_members_org_id_uq").on(t.organizationId, t.id),
    index("organization_members_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------------- */
/* roles / permissions                                                         */
/* ------------------------------------------------------------------------- */

/** System roles have organization_id NULL; organizations may define custom roles later. */
export const roles = pgTable(
  "roles",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("roles_system_key_uq").on(t.key).where(sql`${t.organizationId} is null`),
    uniqueIndex("roles_org_key_uq").on(t.organizationId, t.key).where(sql`${t.organizationId} is not null`),
    check("roles_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]{1,40}$'`),
  ],
);

export const permissions = pgTable(
  "permissions",
  {
    id: id(),
    key: text("key").notNull(),
    description: text("description").notNull().default(""),
  },
  (t) => [
    uniqueIndex("permissions_key_uq").on(t.key),
    check("permissions_key_format", sql`${t.key} ~ '^[a-z]+\\.[a-z]+$'`),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

/**
 * A role granted to a member, organization-wide (event_id NULL) or scoped to one event.
 * `event_id` gets its FK in Phase 2 (events table).
 */
export const memberRoleAssignments = pgTable(
  "member_role_assignments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    memberId: uuid("member_id").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    eventId: uuid("event_id"),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.memberId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.id],
      name: "member_role_assignments_member_fk",
    }).onDelete("cascade"),
    uniqueIndex("member_role_assignments_org_scope_uq").on(t.memberId, t.roleId).where(sql`${t.eventId} is null`),
    uniqueIndex("member_role_assignments_event_scope_uq")
      .on(t.memberId, t.roleId, t.eventId)
      .where(sql`${t.eventId} is not null`),
    index("member_role_assignments_org_idx").on(t.organizationId),
  ],
);

/* ------------------------------------------------------------------------- */
/* organization_invitations                                                    */
/* ------------------------------------------------------------------------- */

export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "revoked", "expired"]);

/**
 * Invitation to join an organization with one role (org-wide or event-scoped).
 * Only the SHA-256 hash of the token is stored; the raw token travels in the e-mail link once.
 * Lifecycle: pending → accepted | revoked | expired. Retention: 1 year then purged.
 */
export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    eventId: uuid("event_id"),
    tokenHash: text("token_hash").notNull(),
    status: invitationStatus("status").notNull().default("pending"),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("organization_invitations_token_hash_uq").on(t.tokenHash),
    uniqueIndex("organization_invitations_pending_email_uq")
      .on(t.organizationId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index("organization_invitations_org_idx").on(t.organizationId, t.status),
    check("organization_invitations_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);

/* ------------------------------------------------------------------------- */
/* audit_logs                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Append-only audit trail of sensitive actions. Never updated or deleted by the application.
 * Retention: 5 years (financial actions will be recorded here too).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    check("audit_logs_actor_kind", sql`${t.actorKind} in ('user','system','webhook','anonymous')`),
    check("audit_logs_action_format", sql`${t.action} ~ '^[a-z_]+\\.[a-z_]+$'`),
  ],
);
