import { sql } from "drizzle-orm";
import {
  bigint,
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
import { id, lazyForeignKey, timestamps } from "./_shared";
import { users } from "./auth";
import { events } from "./events";
import { organizations } from "./identity";
import { campaignRecipients, campaigns, trackingLinks } from "./marketing";

/**
 * TICKETING + PAYMENTS domains (phase 3).
 *
 * Invariants carried by the database:
 * - every row references its organization AND its parent through composite FKs
 *   (organization_id, parent_id) → no cross-tenant association is possible;
 * - a payment-provider event is processed at most once: UNIQUE (provider, provider_event_id);
 * - a single-entry ticket is accepted at most once: UNIQUE (ticket_id) WHERE result = 'accepted';
 * - money is integer minor units, never negative; order totals are consistent by CHECK.
 * Inventory (no overselling) is guarded in transactions with row locks — see domain/ticketing.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => integer(name).notNull().default(0);

/* ------------------------------------------------------------------------- */
/* ticket_types + pools                                                        */
/* ------------------------------------------------------------------------- */

export const ticketTypeStatus = pgEnum("ticket_type_status", ["active", "archived"]);

/** A ticket category of an event (free or paid), with its own quota and sales window. */
export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Unit price in minor units (0 = free ticket, no payment, no fee). */
    priceMinor: money("price_minor"),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    /** null = bounded only by pools / event capacity. */
    quota: integer("quota"),
    salesStartAt: ts("sales_start_at"),
    salesEndAt: ts("sales_end_at"),
    minPerOrder: integer("min_per_order").notNull().default(1),
    maxPerOrder: integer("max_per_order").notNull().default(10),
    /** Hidden categories are purchasable only through a direct link with the type id (invitations, partners). */
    hidden: boolean("hidden").notNull().default(false),
    /** Reserved to e-mails holding an ACTIVE membership of the organization (checked at reservation and checkout). */
    membersOnly: boolean("members_only").notNull().default(false),
    position: integer("position").notNull().default(0),
    status: ticketTypeStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("ticket_types_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "ticket_types_event_fk",
    }).onDelete("cascade"),
    index("ticket_types_event_idx").on(t.eventId, t.position),
    check("ticket_types_name_len", sql`char_length(${t.name}) between 1 and 80`),
    check("ticket_types_price_nonneg", sql`${t.priceMinor} >= 0`),
    check("ticket_types_currency_upper", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("ticket_types_quota_nonneg", sql`${t.quota} is null or ${t.quota} >= 0`),
    check("ticket_types_per_order", sql`${t.minPerOrder} >= 1 and ${t.maxPerOrder} >= ${t.minPerOrder}`),
    check(
      "ticket_types_sales_window",
      sql`${t.salesStartAt} is null or ${t.salesEndAt} is null or ${t.salesEndAt} > ${t.salesStartAt}`,
    ),
  ],
);

/** Shared capacity across several ticket types (e.g. "salle" 900 shared by two waves). */
export const ticketInventoryPools = pgTable(
  "ticket_inventory_pools",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("ticket_inventory_pools_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "ticket_inventory_pools_event_fk",
    }).onDelete("cascade"),
    check("ticket_inventory_pools_capacity_nonneg", sql`${t.capacity} >= 0`),
    check("ticket_inventory_pools_name_len", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const ticketPoolLinks = pgTable(
  "ticket_pool_links",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    poolId: uuid("pool_id").notNull(),
    ticketTypeId: uuid("ticket_type_id").notNull(),
  },
  (t) => [
    uniqueIndex("ticket_pool_links_uq").on(t.poolId, t.ticketTypeId),
    foreignKey({
      columns: [t.organizationId, t.poolId],
      foreignColumns: [ticketInventoryPools.organizationId, ticketInventoryPools.id],
      name: "ticket_pool_links_pool_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.ticketTypeId],
      foreignColumns: [ticketTypes.organizationId, ticketTypes.id],
      name: "ticket_pool_links_type_fk",
    }).onDelete("cascade"),
  ],
);

/* ------------------------------------------------------------------------- */
/* orders                                                                      */
/* ------------------------------------------------------------------------- */

export const orderStatus = pgEnum("order_status", [
  "draft",
  "reserved",
  "awaiting_payment",
  "paid",
  "failed",
  "expired",
  "partially_refunded",
  "refunded",
]);

/**
 * A purchase (guest or signed-in). Amounts in minor units:
 * total = subtotal - discount + fees. `access_token_hash` authenticates the buyer's links.
 */
export const orders = pgTable(
  "orders",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    /** Human reference, unique per organization: KR-1000, KR-1001… */
    number: text("number").notNull(),
    status: orderStatus("status").notNull().default("draft"),
    buyerEmail: text("buyer_email").notNull(),
    buyerFirstName: text("buyer_first_name"),
    buyerLastName: text("buyer_last_name"),
    /** Signed-in buyer, when any (guest checkout leaves it null). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    subtotalMinor: money("subtotal_minor"),
    discountMinor: money("discount_minor"),
    feesMinor: money("fees_minor"),
    totalMinor: money("total_minor"),
    promoCodeId: uuid("promo_code_id"),
    /**
     * SHA-256 of the buyer access token (links in e-mails). The token itself is derived
     * server-side from (order id, secret_version) with a server key and never stored; bumping
     * `secret_version` revokes every link sent so far.
     */
    accessTokenHash: text("access_token_hash").notNull(),
    secretVersion: integer("secret_version").notNull().default(1),
    /** Reservation deadline while unpaid; null once paid. */
    expiresAt: ts("expires_at"),
    paidAt: ts("paid_at"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    /**
     * Campaign attribution (phase 8), set at reservation when the buyer arrived through a valid
     * tracked campaign link. Link-level evidence only — never an identity resolution by e-mail.
     */
    campaignId: uuid("campaign_id"),
    trackingLinkId: uuid("tracking_link_id"),
    campaignRecipientId: uuid("campaign_recipient_id"),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("orders_org_id_uq").on(t.organizationId, t.id),
    index("orders_campaign_idx").on(t.campaignId, t.status),
    lazyForeignKey(() => ({
      name: "orders_campaign_fk",
      columns: [t.organizationId, t.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
    })).onDelete("set null"),
    lazyForeignKey(() => ({
      name: "orders_tracking_link_fk",
      columns: [t.organizationId, t.trackingLinkId],
      foreignColumns: [trackingLinks.organizationId, trackingLinks.id],
    })).onDelete("set null"),
    lazyForeignKey(() => ({
      name: "orders_campaign_recipient_fk",
      columns: [t.organizationId, t.campaignRecipientId],
      foreignColumns: [campaignRecipients.organizationId, campaignRecipients.id],
    })).onDelete("set null"),
    uniqueIndex("orders_org_number_uq").on(t.organizationId, t.number),
    uniqueIndex("orders_access_token_uq").on(t.accessTokenHash),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "orders_event_fk",
    }).onDelete("restrict"),
    index("orders_event_status_idx").on(t.eventId, t.status, t.createdAt),
    index("orders_buyer_email_idx").on(t.buyerEmail),
    index("orders_user_idx").on(t.userId),
    index("orders_expiry_idx").on(t.status, t.expiresAt),
    // Dashboards / finances (phase 10): per-organization figures by status and payment date.
    index("orders_org_status_paid_idx").on(t.organizationId, t.status, t.paidAt),
    check("orders_amounts_nonneg", sql`${t.subtotalMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.feesMinor} >= 0`),
    check("orders_total_consistent", sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor} + ${t.feesMinor}`),
    check("orders_email_lower", sql`${t.buyerEmail} = lower(${t.buyerEmail})`),
    check("orders_version_pos", sql`${t.version} >= 1`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    ticketTypeId: uuid("ticket_type_id").notNull(),
    /** Snapshot of the type name at purchase time (types can be renamed later). */
    label: text("label").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: money("unit_price_minor"),
    unitFeeMinor: money("unit_fee_minor"),
  },
  (t) => [
    unique("order_items_order_type_uq").on(t.orderId, t.ticketTypeId),
    foreignKey({
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
      name: "order_items_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.ticketTypeId],
      foreignColumns: [ticketTypes.organizationId, ticketTypes.id],
      name: "order_items_type_fk",
    }).onDelete("restrict"),
    check("order_items_quantity_pos", sql`${t.quantity} >= 1`),
    check("order_items_amounts_nonneg", sql`${t.unitPriceMinor} >= 0 and ${t.unitFeeMinor} >= 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* inventory holds                                                             */
/* ------------------------------------------------------------------------- */

export const holdStatus = pgEnum("inventory_hold_status", ["active", "consumed", "released"]);

/** Time-limited reservation attached to an unpaid order. Counted as sold while active. */
export const inventoryHolds = pgTable(
  "inventory_holds",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    orderId: uuid("order_id").notNull(),
    status: holdStatus("status").notNull().default("active"),
    expiresAt: ts("expires_at").notNull(),
    releasedAt: ts("released_at"),
    consumedAt: ts("consumed_at"),
    ...timestamps(),
  },
  (t) => [
    unique("inventory_holds_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("inventory_holds_order_uq").on(t.orderId),
    foreignKey({
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
      name: "inventory_holds_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "inventory_holds_event_fk",
    }).onDelete("cascade"),
    index("inventory_holds_active_idx").on(t.eventId, t.status, t.expiresAt),
  ],
);

export const inventoryHoldItems = pgTable(
  "inventory_hold_items",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    holdId: uuid("hold_id").notNull(),
    ticketTypeId: uuid("ticket_type_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    unique("inventory_hold_items_uq").on(t.holdId, t.ticketTypeId),
    foreignKey({
      columns: [t.organizationId, t.holdId],
      foreignColumns: [inventoryHolds.organizationId, inventoryHolds.id],
      name: "inventory_hold_items_hold_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.ticketTypeId],
      foreignColumns: [ticketTypes.organizationId, ticketTypes.id],
      name: "inventory_hold_items_type_fk",
    }).onDelete("cascade"),
    index("inventory_hold_items_type_idx").on(t.ticketTypeId),
    check("inventory_hold_items_quantity_pos", sql`${t.quantity} >= 1`),
  ],
);

/* ------------------------------------------------------------------------- */
/* tickets + check-ins                                                         */
/* ------------------------------------------------------------------------- */

export const ticketStatus = pgEnum("ticket_status", ["pending", "valid", "used", "revoked", "refunded"]);

/**
 * One ticket per seat. `qr_credential_hash` = SHA-256 of an opaque credential derived
 * server-side (HMAC of ticket id + secret_version, never stored in clear) and shown to the
 * holder as a QR code. `view_token_hash` authenticates the ticket page link and is distinct
 * from the scan credential.
 */
export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    orderId: uuid("order_id").notNull(),
    ticketTypeId: uuid("ticket_type_id").notNull(),
    /** KR-1000-01 */
    number: text("number").notNull(),
    attendeeName: text("attendee_name"),
    status: ticketStatus("status").notNull().default("pending"),
    priceMinor: money("price_minor"),
    feeMinor: money("fee_minor"),
    qrCredentialHash: text("qr_credential_hash").notNull(),
    viewTokenHash: text("view_token_hash").notNull(),
    /** Bumped to revoke the QR credential and the view link (re-issue). */
    secretVersion: integer("secret_version").notNull().default(1),
    issuedAt: ts("issued_at"),
    usedAt: ts("used_at"),
    revokedAt: ts("revoked_at"),
    refundedAt: ts("refunded_at"),
    ...timestamps(),
  },
  (t) => [
    unique("tickets_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("tickets_org_number_uq").on(t.organizationId, t.number),
    uniqueIndex("tickets_qr_hash_uq").on(t.qrCredentialHash),
    uniqueIndex("tickets_view_token_uq").on(t.viewTokenHash),
    foreignKey({
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
      name: "tickets_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "tickets_event_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.ticketTypeId],
      foreignColumns: [ticketTypes.organizationId, ticketTypes.id],
      name: "tickets_type_fk",
    }).onDelete("restrict"),
    index("tickets_event_status_idx").on(t.eventId, t.status),
    index("tickets_type_status_idx").on(t.ticketTypeId, t.status),
    index("tickets_org_status_idx").on(t.organizationId, t.status),
    check("tickets_amounts_nonneg", sql`${t.priceMinor} >= 0 and ${t.feeMinor} >= 0`),
    check("tickets_used_consistent", sql`${t.status} <> 'used' or ${t.usedAt} is not null`),
  ],
);

export const checkinResult = pgEnum("checkin_result", ["accepted", "already_used", "revoked", "refunded", "invalid"]);

/** Every scan attempt. Partial unique index: a ticket is ACCEPTED at most once. */
export const checkins = pgTable(
  "checkins",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    /** null when the credential matched no ticket (result = invalid). */
    ticketId: uuid("ticket_id"),
    result: checkinResult("result").notNull(),
    scannedBy: uuid("scanned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    device: text("device"),
    scannedAt: ts("scanned_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("checkins_accepted_once_uq").on(t.ticketId).where(sql`${t.result} = 'accepted'`),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "checkins_event_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.ticketId],
      foreignColumns: [tickets.organizationId, tickets.id],
      name: "checkins_ticket_fk",
    }).onDelete("cascade"),
    index("checkins_event_time_idx").on(t.eventId, t.scannedAt),
  ],
);

/* ------------------------------------------------------------------------- */
/* promo codes                                                                 */
/* ------------------------------------------------------------------------- */

export const promoDiscountKind = pgEnum("promo_discount_kind", ["percent", "amount"]);

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    /** Stored upper-case, matched case-insensitively. */
    code: text("code").notNull(),
    kind: promoDiscountKind("kind").notNull(),
    /** percent: basis points (1000 = 10 %) ; amount: minor units per order. */
    value: integer("value").notNull(),
    maxRedemptions: integer("max_redemptions"),
    validFrom: ts("valid_from"),
    validUntil: ts("valid_until"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique("promo_codes_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("promo_codes_event_code_uq").on(t.eventId, t.code),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: "promo_codes_event_fk",
    }).onDelete("cascade"),
    check("promo_codes_code_format", sql`${t.code} ~ '^[A-Z0-9-]{3,30}$'`),
    check("promo_codes_value_pos", sql`${t.value} > 0`),
    check("promo_codes_percent_max", sql`${t.kind} <> 'percent' or ${t.value} <= 10000`),
  ],
);

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    promoCodeId: uuid("promo_code_id").notNull(),
    orderId: uuid("order_id").notNull(),
    discountMinor: money("discount_minor"),
    redeemedAt: ts("redeemed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("promo_redemptions_order_uq").on(t.orderId),
    foreignKey({
      columns: [t.organizationId, t.promoCodeId],
      foreignColumns: [promoCodes.organizationId, promoCodes.id],
      name: "promo_redemptions_code_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
      name: "promo_redemptions_order_fk",
    }).onDelete("cascade"),
  ],
);

/* ------------------------------------------------------------------------- */
/* payments                                                                    */
/* ------------------------------------------------------------------------- */

export const paymentProvider = pgEnum("payment_provider", ["stripe", "fake"]);
export const paymentAccountStatus = pgEnum("payment_account_status", [
  "pending",
  "active",
  "restricted",
  "disconnected",
]);

/** The organization's connected account at the provider (Stripe Connect). */
export const paymentAccounts = pgTable(
  "payment_accounts",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: paymentProvider("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    status: paymentAccountStatus("status").notNull().default("pending"),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    lastSyncedAt: ts("last_synced_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("payment_accounts_org_provider_uq").on(t.organizationId, t.provider),
    uniqueIndex("payment_accounts_provider_id_uq").on(t.provider, t.providerAccountId),
  ],
);

export const paymentStatus = pgEnum("payment_status", [
  "created",
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Exactly one of order_id / membership_id is set (CHECK below). */
    orderId: uuid("order_id"),
    membershipId: uuid("membership_id"),
    provider: paymentProvider("provider").notNull(),
    /** Checkout session / intent reference at the provider. */
    providerRef: text("provider_ref").notNull(),
    /** Charge / payment-intent reference once known (needed for refunds). */
    providerChargeRef: text("provider_charge_ref"),
    status: paymentStatus("status").notNull().default("created"),
    amountMinor: money("amount_minor"),
    applicationFeeMinor: money("application_fee_minor"),
    refundedMinor: money("refunded_minor"),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    /** Card brand + last4 as reported by the provider (display only). */
    methodLabel: text("method_label"),
    succeededAt: ts("succeeded_at"),
    failedAt: ts("failed_at"),
    failureReason: text("failure_reason"),
    ...timestamps(),
  },
  (t) => [
    unique("payments_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("payments_provider_ref_uq").on(t.provider, t.providerRef),
    foreignKey({
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
      name: "payments_order_fk",
    }).onDelete("cascade"),
    index("payments_order_idx").on(t.orderId, t.createdAt),
    check(
      "payments_amounts_nonneg",
      sql`${t.amountMinor} >= 0 and ${t.applicationFeeMinor} >= 0 and ${t.refundedMinor} >= 0`,
    ),
    check("payments_refunded_le_amount", sql`${t.refundedMinor} <= ${t.amountMinor}`),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id").notNull(),
    status: paymentStatus("status").notNull(),
    providerEventId: text("provider_event_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.paymentId],
      foreignColumns: [payments.organizationId, payments.id],
      name: "payment_attempts_payment_fk",
    }).onDelete("cascade"),
    index("payment_attempts_payment_idx").on(t.paymentId, t.occurredAt),
  ],
);

/** Idempotency ledger for provider webhooks: an event id is processed at most once. */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: id(),
    provider: paymentProvider("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    /** applied | ignored_out_of_order | ignored_unknown | error */
    outcome: text("outcome"),
    error: text("error"),
  },
  (t) => [uniqueIndex("payment_webhook_events_uq").on(t.provider, t.providerEventId)],
);

/* ------------------------------------------------------------------------- */
/* refunds                                                                     */
/* ------------------------------------------------------------------------- */

export const refundStatus = pgEnum("refund_status", ["pending", "succeeded", "failed"]);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    paymentId: uuid("payment_id"),
    amountMinor: integer("amount_minor").notNull(),
    reason: text("reason").notNull(),
    status: refundStatus("status").notNull().default("pending"),
    providerRef: text("provider_ref"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    succeededAt: ts("succeeded_at"),
    failedAt: ts("failed_at"),
    failureReason: text("failure_reason"),
    ...timestamps(),
  },
  (t) => [
    unique("refunds_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
      name: "refunds_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.paymentId],
      foreignColumns: [payments.organizationId, payments.id],
      name: "refunds_payment_fk",
    }).onDelete("set null"),
    index("refunds_order_idx").on(t.orderId),
    index("refunds_org_status_idx").on(t.organizationId, t.status, t.succeededAt),
    check("refunds_amount_pos", sql`${t.amountMinor} > 0`),
    check("refunds_reason_len", sql`char_length(${t.reason}) between 3 and 500`),
  ],
);

export const refundItems = pgTable(
  "refund_items",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    refundId: uuid("refund_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
  },
  (t) => [
    uniqueIndex("refund_items_uq").on(t.refundId, t.ticketId),
    foreignKey({
      columns: [t.organizationId, t.refundId],
      foreignColumns: [refunds.organizationId, refunds.id],
      name: "refund_items_refund_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.ticketId],
      foreignColumns: [tickets.organizationId, tickets.id],
      name: "refund_items_ticket_fk",
    }).onDelete("cascade"),
    check("refund_items_amount_nonneg", sql`${t.amountMinor} >= 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* ledger (double entry)                                                       */
/* ------------------------------------------------------------------------- */

export const ledgerAccountKind = pgEnum("ledger_account_kind", [
  "receivable_provider",
  "revenue_tickets",
  "platform_fees",
  "refunds_payable",
]);

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: ledgerAccountKind("kind").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    ...timestamps(),
  },
  (t) => [
    unique("ledger_accounts_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("ledger_accounts_org_kind_uq").on(t.organizationId, t.kind, t.currency),
  ],
);

export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** order_paid | order_refunded */
    kind: text("kind").notNull(),
    orderId: uuid("order_id"),
    reference: text("reference"),
    description: text("description"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_transactions_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
      name: "ledger_transactions_order_fk",
    }).onDelete("set null"),
    index("ledger_transactions_org_time_idx").on(t.organizationId, t.occurredAt),
  ],
);

/** Signed amount in minor units: debit > 0, credit < 0. Σ per transaction = 0 (checked in domain). */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    accountId: uuid("account_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.transactionId],
      foreignColumns: [ledgerTransactions.organizationId, ledgerTransactions.id],
      name: "ledger_entries_transaction_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.accountId],
      foreignColumns: [ledgerAccounts.organizationId, ledgerAccounts.id],
      name: "ledger_entries_account_fk",
    }).onDelete("restrict"),
    index("ledger_entries_account_idx").on(t.accountId),
    check("ledger_entries_nonzero", sql`${t.amountMinor} <> 0`),
  ],
);

/** Receipts and statements (phase 7). Posed now so the ledger can reference them later. */
export const financialDocuments = pgTable(
  "financial_documents",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    reference: text("reference").notNull(),
    orderId: uuid("order_id"),
    fileId: uuid("file_id"),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("financial_documents_org_ref_uq").on(t.organizationId, t.reference),
    foreignKey({
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
      name: "financial_documents_order_fk",
    }).onDelete("set null"),
  ],
);
