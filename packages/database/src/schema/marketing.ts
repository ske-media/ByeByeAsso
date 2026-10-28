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
import { contacts, segments } from "./crm";
import { organizations } from "./identity";

/**
 * MARKETING domain (phase 8). Campaigns are per organization; eligibility (consent, suppression,
 * duplicate, validity) is re-validated at dispatch time, never trusted from the audience snapshot.
 * Invariants in the database:
 * - one recipient row per (campaign, e-mail) → duplicate recipient suppression;
 * - provider callbacks are idempotent by (provider, provider_message_id);
 * - tracking stores no IP address; events and audience snapshots are append-only.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const campaignStatus = pgEnum("campaign_status", [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "partially_failed",
  "failed",
  "cancelled",
]);
export const campaignRecipientStatus = pgEnum("campaign_recipient_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
  "bounced",
  "unsubscribed",
]);
export const deliveryKind = pgEnum("delivery_kind", ["campaign", "transactional", "test"]);
export const deliveryStatus = pgEnum("delivery_status", [
  "queued",
  "accepted",
  "delivered",
  "bounced",
  "complained",
  "failed",
]);
export const trackingEventKind = pgEnum("tracking_event_kind", ["click", "unsubscribe"]);

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    subject: text("subject").notNull().default(""),
    preheader: text("preheader"),
    body: text("body").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: ts("archived_at"),
    ...timestamps(),
  },
  (t) => [
    unique("email_templates_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("email_templates_org_slug_uq").on(t.organizationId, t.slug),
    check("email_templates_name_length", sql`char_length(${t.name}) between 1 and 120`),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Stable identifier used as `utm_campaign`. */
    slug: text("slug").notNull(),
    status: campaignStatus("status").notNull().default("draft"),
    subject: text("subject").notNull().default(""),
    preheader: text("preheader"),
    fromName: text("from_name").notNull().default(""),
    replyTo: text("reply_to"),
    body: text("body").notNull().default(""),
    templateId: uuid("template_id"),
    segmentId: uuid("segment_id"),
    /** Legal decision taken at verification: include `customer_only` contacts (existing-customer exception). */
    includeCustomerException: boolean("include_customer_exception").notNull().default(false),
    legalNote: text("legal_note"),
    scheduledAt: ts("scheduled_at"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    audienceCount: integer("audience_count"),
    eligibleCount: integer("eligible_count"),
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    error: text("error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    scheduledBy: uuid("scheduled_by").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("campaigns_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("campaigns_org_slug_uq").on(t.organizationId, t.slug),
    index("campaigns_due_idx").on(t.status, t.scheduledAt),
    foreignKey({
      columns: [t.organizationId, t.segmentId],
      foreignColumns: [segments.organizationId, segments.id],
      name: "campaigns_segment_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.organizationId, t.templateId],
      foreignColumns: [emailTemplates.organizationId, emailTemplates.id],
      name: "campaigns_template_fk",
    }).onDelete("set null"),
    check("campaigns_name_length", sql`char_length(${t.name}) between 1 and 120`),
    check("campaigns_counters_nonneg", sql`${t.sentCount} >= 0 and ${t.failedCount} >= 0 and ${t.skippedCount} >= 0`),
    check("campaigns_scheduled_has_time", sql`${t.status} <> 'scheduled' or ${t.scheduledAt} is not null`),
    check(
      "campaigns_started_when_running",
      sql`${t.status} not in ('sending','sent','partially_failed','failed') or ${t.startedAt} is not null`,
    ),
    check("campaigns_version_pos", sql`${t.version} >= 1`),
  ],
);

/** Audience snapshot (append-only): taken when scheduling, and again at dispatch. */
export const campaignAudiences = pgTable(
  "campaign_audiences",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    segmentId: uuid("segment_id"),
    definition: jsonb("definition").notNull(),
    computedAt: ts("computed_at").notNull().defaultNow(),
    stage: text("stage").notNull().default("check"),
    segmentCount: integer("segment_count").notNull().default(0),
    notConsentedCount: integer("not_consented_count").notNull().default(0),
    suppressedCount: integer("suppressed_count").notNull().default(0),
    invalidCount: integer("invalid_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    eligibleCount: integer("eligible_count").notNull().default(0),
  },
  (t) => [
    index("campaign_audiences_campaign_idx").on(t.campaignId, t.computedAt),
    foreignKey({
      columns: [t.organizationId, t.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
      name: "campaign_audiences_campaign_fk",
    }).onDelete("cascade"),
    check("campaign_audiences_stage", sql`${t.stage} in ('check','schedule','dispatch')`),
  ],
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    status: campaignRecipientStatus("status").notNull().default("pending"),
    skipReason: text("skip_reason"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: ts("sent_at"),
    deliveryId: uuid("delivery_id"),
    clicksCount: integer("clicks_count").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("campaign_recipients_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("campaign_recipients_campaign_email_uq").on(t.campaignId, t.email),
    index("campaign_recipients_campaign_status_idx").on(t.campaignId, t.status),
    index("campaign_recipients_contact_idx").on(t.contactId),
    foreignKey({
      columns: [t.organizationId, t.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
      name: "campaign_recipients_campaign_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "campaign_recipients_contact_fk",
    }).onDelete("cascade"),
    check("campaign_recipients_email_lower", sql`${t.email} = lower(${t.email})`),
    check("campaign_recipients_attempts_nonneg", sql`${t.attempts} >= 0`),
  ],
);

export const messageDeliveries = pgTable(
  "message_deliveries",
  {
    id: id(),
    organizationId: uuid("organization_id"),
    kind: deliveryKind("kind").notNull(),
    campaignId: uuid("campaign_id"),
    recipientId: uuid("recipient_id"),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull().default(""),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    status: deliveryStatus("status").notNull().default("queued"),
    error: text("error"),
    acceptedAt: ts("accepted_at"),
    deliveredAt: ts("delivered_at"),
    bouncedAt: ts("bounced_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("message_deliveries_provider_uq")
      .on(t.provider, t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    index("message_deliveries_campaign_idx").on(t.campaignId, t.status),
    index("message_deliveries_recipient_idx").on(t.recipientId),
    index("message_deliveries_email_idx").on(t.toEmail, t.createdAt),
  ],
);

export const trackingLinks = pgTable(
  "tracking_links",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    token: text("token").notNull(),
    targetUrl: text("target_url").notNull(),
    label: text("label"),
    clicksCount: integer("clicks_count").notNull().default(0),
    uniqueClicksCount: integer("unique_clicks_count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("tracking_links_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("tracking_links_token_uq").on(t.token),
    uniqueIndex("tracking_links_campaign_target_uq").on(t.campaignId, t.targetUrl),
    foreignKey({
      columns: [t.organizationId, t.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
      name: "tracking_links_campaign_fk",
    }).onDelete("cascade"),
    check("tracking_links_token_length", sql`char_length(${t.token}) between 16 and 64`),
    check("tracking_links_target_http", sql`${t.targetUrl} ~ '^https?://'`),
  ],
);

/** Click / unsubscribe events. No IP address is ever stored; the user agent is truncated. */
export const trackingEvents = pgTable(
  "tracking_events",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    linkId: uuid("link_id"),
    recipientId: uuid("recipient_id"),
    kind: trackingEventKind("kind").notNull(),
    userAgent: text("user_agent"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("tracking_events_campaign_idx").on(t.campaignId, t.kind, t.occurredAt),
    index("tracking_events_link_idx").on(t.linkId),
    foreignKey({
      columns: [t.organizationId, t.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
      name: "tracking_events_campaign_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.linkId],
      foreignColumns: [trackingLinks.organizationId, trackingLinks.id],
      name: "tracking_events_link_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.recipientId],
      foreignColumns: [campaignRecipients.organizationId, campaignRecipients.id],
      name: "tracking_events_recipient_fk",
    }).onDelete("set null"),
    check("tracking_events_ua_length", sql`${t.userAgent} is null or char_length(${t.userAgent}) <= 200`),
  ],
);
