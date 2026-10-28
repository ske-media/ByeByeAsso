CREATE TYPE "public"."campaign_recipient_status" AS ENUM('pending', 'sent', 'failed', 'skipped', 'bounced', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'partially_failed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."delivery_kind" AS ENUM('campaign', 'transactional', 'test');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'accepted', 'delivered', 'bounced', 'complained', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tracking_event_kind" AS ENUM('click', 'unsubscribe');--> statement-breakpoint
CREATE TABLE "campaign_audiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"segment_id" uuid,
	"definition" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage" text DEFAULT 'check' NOT NULL,
	"segment_count" integer DEFAULT 0 NOT NULL,
	"not_consented_count" integer DEFAULT 0 NOT NULL,
	"suppressed_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "campaign_audiences_stage" CHECK ("campaign_audiences"."stage" in ('check','schedule','dispatch'))
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"status" "campaign_recipient_status" DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"delivery_id" uuid,
	"clicks_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_recipients_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "campaign_recipients_email_lower" CHECK ("campaign_recipients"."email" = lower("campaign_recipients"."email")),
	CONSTRAINT "campaign_recipients_attempts_nonneg" CHECK ("campaign_recipients"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"preheader" text,
	"from_name" text DEFAULT '' NOT NULL,
	"reply_to" text,
	"body" text DEFAULT '' NOT NULL,
	"template_id" uuid,
	"segment_id" uuid,
	"include_customer_exception" boolean DEFAULT false NOT NULL,
	"legal_note" text,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"audience_count" integer,
	"eligible_count" integer,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" uuid,
	"scheduled_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "campaigns_name_length" CHECK (char_length("campaigns"."name") between 1 and 120),
	CONSTRAINT "campaigns_counters_nonneg" CHECK ("campaigns"."sent_count" >= 0 and "campaigns"."failed_count" >= 0 and "campaigns"."skipped_count" >= 0),
	CONSTRAINT "campaigns_scheduled_has_time" CHECK ("campaigns"."status" <> 'scheduled' or "campaigns"."scheduled_at" is not null),
	CONSTRAINT "campaigns_started_when_running" CHECK ("campaigns"."status" not in ('sending','sent','partially_failed','failed') or "campaigns"."started_at" is not null),
	CONSTRAINT "campaigns_version_pos" CHECK ("campaigns"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"preheader" text,
	"body" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "email_templates_name_length" CHECK (char_length("email_templates"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "message_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"kind" "delivery_kind" NOT NULL,
	"campaign_id" uuid,
	"recipient_id" uuid,
	"to_email" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"link_id" uuid,
	"recipient_id" uuid,
	"kind" "tracking_event_kind" NOT NULL,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_events_ua_length" CHECK ("tracking_events"."user_agent" is null or char_length("tracking_events"."user_agent") <= 200)
);
--> statement-breakpoint
CREATE TABLE "tracking_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"token" text NOT NULL,
	"target_url" text NOT NULL,
	"label" text,
	"clicks_count" integer DEFAULT 0 NOT NULL,
	"unique_clicks_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_links_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "tracking_links_token_length" CHECK (char_length("tracking_links"."token") between 16 and 64),
	CONSTRAINT "tracking_links_target_http" CHECK ("tracking_links"."target_url" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_link_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "campaign_recipient_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_audiences" ADD CONSTRAINT "campaign_audiences_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_scheduled_by_users_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segment_fk" FOREIGN KEY ("organization_id","segment_id") REFERENCES "public"."segments"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_fk" FOREIGN KEY ("organization_id","template_id") REFERENCES "public"."email_templates"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_link_fk" FOREIGN KEY ("organization_id","link_id") REFERENCES "public"."tracking_links"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_recipient_fk" FOREIGN KEY ("organization_id","recipient_id") REFERENCES "public"."campaign_recipients"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_audiences_campaign_idx" ON "campaign_audiences" USING btree ("campaign_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_email_uq" ON "campaign_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_status_idx" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_contact_idx" ON "campaign_recipients" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_org_slug_uq" ON "campaigns" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "campaigns_due_idx" ON "campaigns" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_org_slug_uq" ON "email_templates" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "message_deliveries_provider_uq" ON "message_deliveries" USING btree ("provider","provider_message_id") WHERE "message_deliveries"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "message_deliveries_campaign_idx" ON "message_deliveries" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "message_deliveries_recipient_idx" ON "message_deliveries" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "message_deliveries_email_idx" ON "message_deliveries" USING btree ("to_email","created_at");--> statement-breakpoint
CREATE INDEX "tracking_events_campaign_idx" ON "tracking_events" USING btree ("campaign_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "tracking_events_link_idx" ON "tracking_events" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_links_token_uq" ON "tracking_links" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_links_campaign_target_uq" ON "tracking_links" USING btree ("campaign_id","target_url");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tracking_link_fk" FOREIGN KEY ("organization_id","tracking_link_id") REFERENCES "public"."tracking_links"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_campaign_recipient_fk" FOREIGN KEY ("organization_id","campaign_recipient_id") REFERENCES "public"."campaign_recipients"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_campaign_idx" ON "orders" USING btree ("campaign_id","status");