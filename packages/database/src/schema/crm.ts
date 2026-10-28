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
 * CRM domain (phase 7). One contact base PER ORGANIZATION — never shared across tenants:
 * the same person (same e-mail, same user account) is a distinct contact in each organization.
 * Invariants in the database:
 * - one active contact per (organization, primary e-mail); one identity value per organization;
 * - consent records and merge records are append-only (enforced by the domain, no UPDATE path);
 * - suppressions are keyed by e-mail so they survive merges and archival;
 * - every child row carries organization_id and is bound by composite FKs.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const contactStatus = pgEnum("contact_status", ["active", "merged", "archived"]);
export const contactIdentityKind = pgEnum("contact_identity_kind", ["email", "phone", "user"]);
export const marketingEmailStatus = pgEnum("marketing_email_status", [
  "none",
  "opted_in",
  "customer_only",
  "withdrawn",
  "suppressed",
]);
export const consentChannel = pgEnum("consent_channel", ["email"]);
export const consentStatus = pgEnum("consent_status", ["granted", "withdrawn"]);
export const consentBasis = pgEnum("consent_basis", ["explicit_opt_in", "customer_exception", "manual", "import"]);
export const crmSource = pgEnum("crm_source", [
  "order",
  "membership",
  "volunteer_application",
  "schedule",
  "staff",
  "public_form",
  "import",
  "system",
]);
export const suppressionReason = pgEnum("suppression_reason", [
  "unsubscribed",
  "bounced",
  "complaint",
  "manual",
  "erased",
]);
export const segmentKind = pgEnum("segment_kind", ["dynamic", "static"]);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    primaryEmail: text("primary_email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"),
    city: text("city"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    status: contactStatus("status").notNull().default("active"),
    mergedIntoContactId: uuid("merged_into_contact_id"),
    source: crmSource("source").notNull().default("staff"),
    marketingEmailStatus: marketingEmailStatus("marketing_email_status").notNull().default("none"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastActivityAt: ts("last_activity_at"),
    ordersCount: integer("orders_count").notNull().default(0),
    ticketsCount: integer("tickets_count").notNull().default(0),
    membershipsCount: integer("memberships_count").notNull().default(0),
    applicationsCount: integer("applications_count").notNull().default(0),
    missionsCount: integer("missions_count").notNull().default(0),
    archivedAt: ts("archived_at"),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("contacts_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("contacts_org_email_active_uq").on(t.organizationId, t.primaryEmail).where(sql`${t.status} = 'active'`),
    index("contacts_org_status_idx").on(t.organizationId, t.status),
    index("contacts_org_activity_idx").on(t.organizationId, t.lastActivityAt),
    index("contacts_user_idx").on(t.userId),
    foreignKey({
      columns: [t.organizationId, t.mergedIntoContactId],
      foreignColumns: [t.organizationId, t.id],
      name: "contacts_merged_into_fk",
    }).onDelete("set null"),
    check("contacts_email_lower", sql`${t.primaryEmail} = lower(${t.primaryEmail})`),
    check("contacts_email_format", sql`${t.primaryEmail} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check("contacts_merged_target", sql`(${t.status} = 'merged') = (${t.mergedIntoContactId} is not null)`),
    check("contacts_archived_at", sql`(${t.status} = 'archived') = (${t.archivedAt} is not null)`),
    check(
      "contacts_counters_nonneg",
      sql`${t.ordersCount} >= 0 and ${t.ticketsCount} >= 0 and ${t.membershipsCount} >= 0 and ${t.applicationsCount} >= 0 and ${t.missionsCount} >= 0`,
    ),
    check("contacts_version_pos", sql`${t.version} >= 1`),
  ],
);

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    kind: contactIdentityKind("kind").notNull(),
    value: text("value").notNull(),
    verified: boolean("verified").notNull().default(false),
    isPrimary: boolean("is_primary").notNull().default(false),
    source: crmSource("source").notNull().default("staff"),
    ...timestamps(),
  },
  (t) => [
    // E-mails and accounts point to ONE contact per organization; phones may be shared (household).
    uniqueIndex("contact_identities_org_kind_value_uq")
      .on(t.organizationId, t.kind, t.value)
      .where(sql`${t.kind} <> 'phone'`),
    uniqueIndex("contact_identities_contact_kind_value_uq").on(t.contactId, t.kind, t.value),
    index("contact_identities_org_value_idx").on(t.organizationId, t.kind, t.value),
    index("contact_identities_contact_idx").on(t.contactId),
    foreignKey({
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "contact_identities_contact_fk",
    }).onDelete("cascade"),
    check("contact_identities_value_nonempty", sql`char_length(${t.value}) >= 1`),
    check("contact_identities_email_lower", sql`${t.kind} <> 'email' or ${t.value} = lower(${t.value})`),
  ],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color").notNull().default("lime"),
    ...timestamps(),
  },
  (t) => [
    unique("contact_tags_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("contact_tags_org_slug_uq").on(t.organizationId, t.slug),
    check("contact_tags_slug_format", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
    check("contact_tags_name_length", sql`char_length(${t.name}) between 1 and 60`),
  ],
);

export const contactTagAssignments = pgTable(
  "contact_tag_assignments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_tag_assignments_uq").on(t.contactId, t.tagId),
    index("contact_tag_assignments_tag_idx").on(t.tagId),
    foreignKey({
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "contact_tag_assignments_contact_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.tagId],
      foreignColumns: [contactTags.organizationId, contactTags.id],
      name: "contact_tag_assignments_tag_fk",
    }).onDelete("cascade"),
  ],
);

export const contactNotes = pgTable(
  "contact_notes",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("contact_notes_contact_idx").on(t.contactId, t.createdAt),
    foreignKey({
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "contact_notes_contact_fk",
    }).onDelete("cascade"),
    check("contact_notes_body_length", sql`char_length(${t.body}) between 1 and 4000`),
  ],
);

/** Append-only consent journal. The contact's denormalised status is derived from the latest row per channel. */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    channel: consentChannel("channel").notNull().default("email"),
    status: consentStatus("status").notNull(),
    basis: consentBasis("basis").notNull(),
    source: crmSource("source").notNull(),
    sourceId: uuid("source_id"),
    evidence: text("evidence").notNull(),
    occurredAt: ts("occurred_at").notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("consent_records_contact_idx").on(t.contactId, t.occurredAt),
    uniqueIndex("consent_records_source_uq")
      .on(t.organizationId, t.source, t.sourceId, t.status)
      .where(sql`${t.sourceId} is not null`),
    foreignKey({
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "consent_records_contact_fk",
    }).onDelete("cascade"),
    check("consent_records_evidence_length", sql`char_length(${t.evidence}) between 1 and 1000`),
  ],
);

/** Suppression list keyed by e-mail: survives merges and archival; lifted only by an explicit, reasoned action. */
export const contactSuppressions = pgTable(
  "contact_suppressions",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    reason: suppressionReason("reason").notNull(),
    source: crmSource("source").notNull().default("staff"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    liftedAt: ts("lifted_at"),
    liftedBy: uuid("lifted_by").references(() => users.id, { onDelete: "set null" }),
    liftReason: text("lift_reason"),
  },
  (t) => [
    uniqueIndex("contact_suppressions_active_uq").on(t.organizationId, t.email).where(sql`${t.liftedAt} is null`),
    index("contact_suppressions_org_idx").on(t.organizationId, t.createdAt),
    check("contact_suppressions_email_lower", sql`${t.email} = lower(${t.email})`),
    check(
      "contact_suppressions_lift_reason",
      sql`${t.liftedAt} is null or (${t.liftReason} is not null and char_length(${t.liftReason}) >= 3)`,
    ),
  ],
);

export const contactMergeRecords = pgTable(
  "contact_merge_records",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    survivingContactId: uuid("surviving_contact_id").notNull(),
    mergedContactId: uuid("merged_contact_id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    reason: text("reason"),
    mergedBy: uuid("merged_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("contact_merge_records_surviving_idx").on(t.survivingContactId),
    foreignKey({
      columns: [t.organizationId, t.survivingContactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "contact_merge_records_surviving_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.mergedContactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "contact_merge_records_merged_fk",
    }).onDelete("cascade"),
    check("contact_merge_records_distinct", sql`${t.survivingContactId} <> ${t.mergedContactId}`),
  ],
);

export const segments = pgTable(
  "segments",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    kind: segmentKind("kind").notNull().default("dynamic"),
    definition: jsonb("definition").notNull().default(sql`'{"rules":[]}'::jsonb`),
    memberCount: integer("member_count"),
    computedAt: ts("computed_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: ts("archived_at"),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("segments_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("segments_org_slug_uq").on(t.organizationId, t.slug),
    check("segments_slug_format", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
    check("segments_name_length", sql`char_length(${t.name}) between 1 and 120`),
    check("segments_version_pos", sql`${t.version} >= 1`),
  ],
);

export const segmentMembers = pgTable(
  "segment_members",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    segmentId: uuid("segment_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("segment_members_uq").on(t.segmentId, t.contactId),
    index("segment_members_contact_idx").on(t.contactId),
    foreignKey({
      columns: [t.organizationId, t.segmentId],
      foreignColumns: [segments.organizationId, segments.id],
      name: "segment_members_segment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "segment_members_contact_fk",
    }).onDelete("cascade"),
  ],
);
