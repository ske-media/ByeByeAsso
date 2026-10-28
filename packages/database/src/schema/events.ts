import { sql } from "drizzle-orm";
import {
  boolean,
  char,
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
 * EVENTS domain. Tenant-safe: every event-owned row references `(organization_id, event_id)`
 * through a composite FK so no row can point at an event of another organization.
 */

/* ------------------------------------------------------------------------- */
/* event_locations                                                            */
/* ------------------------------------------------------------------------- */

/** Reusable venues of an organization. Retention: kept while referenced. */
export const eventLocations = pgTable(
  "event_locations",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    postalCode: text("postal_code"),
    city: text("city").notNull(),
    country: char("country", { length: 2 }).notNull().default("FR"),
    /** Accès, transports, accessibilité — affiché sur la page publique. */
    accessNotes: text("access_notes"),
    latitude: text("latitude"),
    longitude: text("longitude"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    unique("event_locations_org_id_uq").on(t.organizationId, t.id),
    index("event_locations_org_idx").on(t.organizationId),
    check("event_locations_name_len", sql`char_length(${t.name}) between 1 and 120`),
    check("event_locations_country_upper", sql`${t.country} ~ '^[A-Z]{2}$'`),
  ],
);

/* ------------------------------------------------------------------------- */
/* events                                                                     */
/* ------------------------------------------------------------------------- */

export const eventStatus = pgEnum("event_status", [
  "draft",
  "published",
  "suspended",
  "completed",
  "cancelled",
  "archived",
]);
export const eventVisibility = pgEnum("event_visibility", ["public", "unlisted", "private"]);
/** not_configured: no sales yet · open: public ticket selection live · closed: sales closed by the organizer or by `sales_close_at`. */
export const ticketingStatus = pgEnum("ticketing_status", ["not_configured", "open", "closed"]);

/**
 * Lifecycle (typed state machine in @kroov/domain/events):
 * draft → published | archived ; published → cancelled | suspended | completed ;
 * suspended → published ; completed | cancelled → archived. `status` is never patched directly.
 */
export const events = pgTable(
  "events",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Accroche courte (affiche, cartes). */
    tagline: text("tagline"),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    doorsAt: timestamp("doors_at", { withTimezone: true, mode: "date" }),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    capacity: integer("capacity").notNull().default(0),
    status: eventStatus("status").notNull().default("draft"),
    visibility: eventVisibility("visibility").notNull().default("public"),
    locationId: uuid("location_id"),
    /** Optimistic concurrency token, incremented on every update. */
    version: integer("version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    cancellationReason: text("cancellation_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /* Ticketing settings (phase 3). */
    ticketingStatus: ticketingStatus("ticketing_status").notNull().default("not_configured"),
    maxTicketsPerOrder: integer("max_tickets_per_order").notNull().default(6),
    /** Hard close of online sales (defaults to the event start when null). */
    salesCloseAt: timestamp("sales_close_at", { withTimezone: true, mode: "date" }),
    /** Each ticket carries an attendee name collected at checkout. */
    nominativeTickets: boolean("nominative_tickets").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("events_org_slug_uq").on(t.organizationId, t.slug),
    unique("events_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [eventLocations.organizationId, eventLocations.id],
      name: "events_location_fk",
    }).onDelete("set null"),
    index("events_org_status_starts_idx").on(t.organizationId, t.status, t.startsAt),
    check("events_slug_format", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'`),
    check("events_title_len", sql`char_length(${t.title}) between 2 and 140`),
    check("events_dates_order", sql`${t.endsAt} > ${t.startsAt}`),
    check("events_doors_before_start", sql`${t.doorsAt} is null or ${t.doorsAt} <= ${t.startsAt}`),
    check("events_capacity_nonneg", sql`${t.capacity} >= 0`),
    check("events_version_pos", sql`${t.version} >= 1`),
    check("events_cancel_reason", sql`${t.status} <> 'cancelled' or ${t.cancellationReason} is not null`),
    check("events_max_per_order", sql`${t.maxTicketsPerOrder} between 1 and 50`),
  ],
);

/** 1:1 settings: public-page content and options. */
export const eventSettings = pgTable(
  "event_settings",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Informations d'accueil et d'accessibilité affichées sur la page publique. */
    accessInfo: text("access_info"),
    /** Programme libre (markdown léger : paragraphes). */
    programme: text("programme"),
    contactEmail: text("contact_email"),
    externalUrl: text("external_url"),
    showRemainingCapacity: boolean("show_remaining_capacity").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "event_settings_event_fk",
    }).onDelete("cascade"),
  ],
);

/* ------------------------------------------------------------------------- */
/* stored_files / event_media (structure only — storage adapter in Phase 9)   */
/* ------------------------------------------------------------------------- */

export const storedFileVisibility = pgEnum("stored_file_visibility", ["private", "public"]);

/** Registry of objects in S3-compatible storage. Never stores file bytes. */
export const storedFiles = pgTable(
  "stored_files",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256"),
    visibility: storedFileVisibility("visibility").notNull().default("private"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stored_files_bucket_key_uq").on(t.bucket, t.objectKey),
    check("stored_files_size_nonneg", sql`${t.sizeBytes} >= 0`),
    check("stored_files_mime_format", sql`${t.mimeType} ~ '^[a-z]+/[a-z0-9.+-]+$'`),
  ],
);

export const eventMediaRole = pgEnum("event_media_role", ["poster", "cover", "gallery"]);

export const eventMedia = pgTable(
  "event_media",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFiles.id, { onDelete: "cascade" }),
    role: eventMediaRole("role").notNull().default("poster"),
    altText: text("alt_text"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "event_media_event_fk",
    }).onDelete("cascade"),
    uniqueIndex("event_media_poster_uq").on(t.eventId).where(sql`${t.role} = 'poster'`),
    index("event_media_event_idx").on(t.eventId),
  ],
);

/* ------------------------------------------------------------------------- */
/* forms (custom questions) — structure for Phases 3 and 5                    */
/* ------------------------------------------------------------------------- */

export const formPurpose = pgEnum("form_purpose", ["order", "volunteer_application", "membership_application"]);

export const formDefinitions = pgTable(
  "form_definitions",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** NULL = organization-level form (memberships); otherwise event-specific. */
    eventId: uuid("event_id"),
    purpose: formPurpose("purpose").notNull(),
    title: text("title").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique("form_definitions_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "form_definitions_event_fk",
    }).onDelete("cascade"),
    index("form_definitions_event_idx").on(t.eventId, t.purpose),
  ],
);

export const formFieldType = pgEnum("form_field_type", [
  "short_text",
  "long_text",
  "single_choice",
  "multiple_choice",
  "checkbox",
  "number",
  "date",
]);

export const formFields = pgTable(
  "form_fields",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    formId: uuid("form_id").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),
    type: formFieldType("type").notNull(),
    required: boolean("required").notNull().default(false),
    /** Choices for single/multiple choice: [{ value, label }]. */
    options: jsonb("options").notNull().default([]),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.formId],
      foreignColumns: [formDefinitions.organizationId, formDefinitions.id],
      name: "form_fields_form_fk",
    }).onDelete("cascade"),
    uniqueIndex("form_fields_form_key_uq").on(t.formId, t.key),
    check("form_fields_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]{0,60}$'`),
  ],
);

export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    formId: uuid("form_id").notNull(),
    /** Polymorphic owner set by the consuming module (order, volunteer application…). */
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.formId],
      foreignColumns: [formDefinitions.organizationId, formDefinitions.id],
      name: "form_submissions_form_fk",
    }).onDelete("cascade"),
    uniqueIndex("form_submissions_subject_uq").on(t.formId, t.subjectType, t.subjectId),
  ],
);

export const formAnswers = pgTable(
  "form_answers",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => formSubmissions.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => formFields.id, { onDelete: "cascade" }),
    /** Normalised value: string, number, boolean or array of strings. */
    value: jsonb("value").notNull(),
  },
  (t) => [uniqueIndex("form_answers_submission_field_uq").on(t.submissionId, t.fieldId)],
);
