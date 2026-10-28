CREATE TYPE "public"."ticketing_status" AS ENUM('not_configured', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."checkin_result" AS ENUM('accepted', 'already_used', 'revoked', 'refunded', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."inventory_hold_status" AS ENUM('active', 'consumed', 'released');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_kind" AS ENUM('receivable_provider', 'revenue_tickets', 'platform_fees', 'refunds_payable');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'reserved', 'awaiting_payment', 'paid', 'failed', 'expired', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_account_status" AS ENUM('pending', 'active', 'restricted', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'fake');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('created', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."promo_discount_kind" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('pending', 'valid', 'used', 'revoked', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."ticket_type_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid,
	"result" "checkin_result" NOT NULL,
	"scanned_by" uuid NOT NULL,
	"device" text,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"order_id" uuid,
	"file_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_hold_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"hold_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventory_hold_items_uq" UNIQUE("hold_id","ticket_type_id"),
	CONSTRAINT "inventory_hold_items_quantity_pos" CHECK ("inventory_hold_items"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inventory_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "inventory_hold_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_holds_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "ledger_account_kind" NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "ledger_entries_nonzero" CHECK ("ledger_entries"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"reference" text,
	"description" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"label" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer DEFAULT 0 NOT NULL,
	"unit_fee_minor" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_items_order_type_uq" UNIQUE("order_id","ticket_type_id"),
	CONSTRAINT "order_items_quantity_pos" CHECK ("order_items"."quantity" >= 1),
	CONSTRAINT "order_items_amounts_nonneg" CHECK ("order_items"."unit_price_minor" >= 0 and "order_items"."unit_fee_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"buyer_email" text NOT NULL,
	"buyer_first_name" text,
	"buyer_last_name" text,
	"user_id" uuid,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"fees_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"promo_code_id" uuid,
	"access_token_hash" text NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "orders_amounts_nonneg" CHECK ("orders"."subtotal_minor" >= 0 and "orders"."discount_minor" >= 0 and "orders"."fees_minor" >= 0),
	CONSTRAINT "orders_total_consistent" CHECK ("orders"."total_minor" = "orders"."subtotal_minor" - "orders"."discount_minor" + "orders"."fees_minor"),
	CONSTRAINT "orders_email_lower" CHECK ("orders"."buyer_email" = lower("orders"."buyer_email")),
	CONSTRAINT "orders_version_pos" CHECK ("orders"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"status" "payment_account_status" DEFAULT 'pending' NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"status" "payment_status" NOT NULL,
	"provider_event_id" text,
	"detail" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_ref" text NOT NULL,
	"provider_charge_ref" text,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"application_fee_minor" integer DEFAULT 0 NOT NULL,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"method_label" text,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "payments_amounts_nonneg" CHECK ("payments"."amount_minor" >= 0 and "payments"."application_fee_minor" >= 0 and "payments"."refunded_minor" >= 0),
	CONSTRAINT "payments_refunded_le_amount" CHECK ("payments"."refunded_minor" <= "payments"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" "promo_discount_kind" NOT NULL,
	"value" integer NOT NULL,
	"max_redemptions" integer,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "promo_codes_code_format" CHECK ("promo_codes"."code" ~ '^[A-Z0-9-]{3,30}$'),
	CONSTRAINT "promo_codes_value_pos" CHECK ("promo_codes"."value" > 0),
	CONSTRAINT "promo_codes_percent_max" CHECK ("promo_codes"."kind" <> 'percent' or "promo_codes"."value" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	CONSTRAINT "refund_items_amount_nonneg" CHECK ("refund_items"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"amount_minor" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"requested_by" uuid,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "refunds_amount_pos" CHECK ("refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_reason_len" CHECK (char_length("refunds"."reason") between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "ticket_inventory_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_inventory_pools_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ticket_inventory_pools_capacity_nonneg" CHECK ("ticket_inventory_pools"."capacity" >= 0),
	CONSTRAINT "ticket_inventory_pools_name_len" CHECK (char_length("ticket_inventory_pools"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "ticket_pool_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"quota" integer,
	"sales_start_at" timestamp with time zone,
	"sales_end_at" timestamp with time zone,
	"min_per_order" integer DEFAULT 1 NOT NULL,
	"max_per_order" integer DEFAULT 10 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "ticket_type_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_types_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ticket_types_name_len" CHECK (char_length("ticket_types"."name") between 1 and 80),
	CONSTRAINT "ticket_types_price_nonneg" CHECK ("ticket_types"."price_minor" >= 0),
	CONSTRAINT "ticket_types_currency_upper" CHECK ("ticket_types"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ticket_types_quota_nonneg" CHECK ("ticket_types"."quota" is null or "ticket_types"."quota" >= 0),
	CONSTRAINT "ticket_types_per_order" CHECK ("ticket_types"."min_per_order" >= 1 and "ticket_types"."max_per_order" >= "ticket_types"."min_per_order"),
	CONSTRAINT "ticket_types_sales_window" CHECK ("ticket_types"."sales_start_at" is null or "ticket_types"."sales_end_at" is null or "ticket_types"."sales_end_at" > "ticket_types"."sales_start_at")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"number" text NOT NULL,
	"attendee_name" text,
	"status" "ticket_status" DEFAULT 'pending' NOT NULL,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"qr_credential_hash" text NOT NULL,
	"view_token_hash" text NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"issued_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "tickets_amounts_nonneg" CHECK ("tickets"."price_minor" >= 0 and "tickets"."fee_minor" >= 0),
	CONSTRAINT "tickets_used_consistent" CHECK ("tickets"."status" <> 'used' or "tickets"."used_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ticketing_status" "ticketing_status" DEFAULT 'not_configured' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "max_tickets_per_order" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sales_close_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "nominative_tickets" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."tickets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_hold_items" ADD CONSTRAINT "inventory_hold_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_hold_items" ADD CONSTRAINT "inventory_hold_items_hold_fk" FOREIGN KEY ("organization_id","hold_id") REFERENCES "public"."inventory_holds"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_hold_items" ADD CONSTRAINT "inventory_hold_items_type_fk" FOREIGN KEY ("organization_id","ticket_type_id") REFERENCES "public"."ticket_types"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_fk" FOREIGN KEY ("organization_id","transaction_id") REFERENCES "public"."ledger_transactions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."ledger_accounts"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_type_fk" FOREIGN KEY ("organization_id","ticket_type_id") REFERENCES "public"."ticket_types"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."payments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_code_fk" FOREIGN KEY ("organization_id","promo_code_id") REFERENCES "public"."promo_codes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_fk" FOREIGN KEY ("organization_id","refund_id") REFERENCES "public"."refunds"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."tickets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."payments"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_inventory_pools" ADD CONSTRAINT "ticket_inventory_pools_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_inventory_pools" ADD CONSTRAINT "ticket_inventory_pools_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_pool_links" ADD CONSTRAINT "ticket_pool_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_pool_links" ADD CONSTRAINT "ticket_pool_links_pool_fk" FOREIGN KEY ("organization_id","pool_id") REFERENCES "public"."ticket_inventory_pools"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_pool_links" ADD CONSTRAINT "ticket_pool_links_type_fk" FOREIGN KEY ("organization_id","ticket_type_id") REFERENCES "public"."ticket_types"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_type_fk" FOREIGN KEY ("organization_id","ticket_type_id") REFERENCES "public"."ticket_types"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkins_accepted_once_uq" ON "checkins" USING btree ("ticket_id") WHERE "checkins"."result" = 'accepted';--> statement-breakpoint
CREATE INDEX "checkins_event_time_idx" ON "checkins" USING btree ("event_id","scanned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_documents_org_ref_uq" ON "financial_documents" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "inventory_hold_items_type_idx" ON "inventory_hold_items" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_holds_order_uq" ON "inventory_holds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_holds_active_idx" ON "inventory_holds" USING btree ("event_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_org_kind_uq" ON "ledger_accounts" USING btree ("organization_id","kind","currency");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_org_time_idx" ON "ledger_transactions" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_number_uq" ON "orders" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_access_token_uq" ON "orders" USING btree ("access_token_hash");--> statement-breakpoint
CREATE INDEX "orders_event_status_idx" ON "orders" USING btree ("event_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_buyer_email_idx" ON "orders" USING btree ("buyer_email");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_expiry_idx" ON "orders" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_org_provider_uq" ON "payment_accounts" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_provider_id_uq" ON "payment_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_payment_idx" ON "payment_attempts" USING btree ("payment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_uq" ON "payment_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_uq" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_event_code_uq" ON "promo_codes" USING btree ("event_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_order_uq" ON "promo_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_items_uq" ON "refund_items" USING btree ("refund_id","ticket_id");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_pool_links_uq" ON "ticket_pool_links" USING btree ("pool_id","ticket_type_id");--> statement-breakpoint
CREATE INDEX "ticket_types_event_idx" ON "ticket_types" USING btree ("event_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_org_number_uq" ON "tickets" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_qr_hash_uq" ON "tickets" USING btree ("qr_credential_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_view_token_uq" ON "tickets" USING btree ("view_token_hash");--> statement-breakpoint
CREATE INDEX "tickets_event_status_idx" ON "tickets" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "tickets_type_status_idx" ON "tickets" USING btree ("ticket_type_id","status");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_max_per_order" CHECK ("events"."max_tickets_per_order" between 1 and 50);