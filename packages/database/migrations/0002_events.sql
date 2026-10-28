CREATE TYPE "public"."event_media_role" AS ENUM('poster', 'cover', 'gallery');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'suspended', 'completed', 'cancelled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('public', 'unlisted', 'private');--> statement-breakpoint
CREATE TYPE "public"."form_field_type" AS ENUM('short_text', 'long_text', 'single_choice', 'multiple_choice', 'checkbox', 'number', 'date');--> statement-breakpoint
CREATE TYPE "public"."form_purpose" AS ENUM('order', 'volunteer_application', 'membership_application');--> statement-breakpoint
CREATE TYPE "public"."stored_file_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "event_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line_1" text,
	"address_line_2" text,
	"postal_code" text,
	"city" text NOT NULL,
	"country" char(2) DEFAULT 'FR' NOT NULL,
	"access_notes" text,
	"latitude" text,
	"longitude" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_locations_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "event_locations_name_len" CHECK (char_length("event_locations"."name") between 1 and 120),
	CONSTRAINT "event_locations_country_upper" CHECK ("event_locations"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "event_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"role" "event_media_role" DEFAULT 'poster' NOT NULL,
	"alt_text" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_settings" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"access_info" text,
	"programme" text,
	"contact_email" text,
	"external_url" text,
	"show_remaining_capacity" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"tagline" text,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"doors_at" timestamp with time zone,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"visibility" "event_visibility" DEFAULT 'public' NOT NULL,
	"location_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "events_slug_format" CHECK ("events"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'),
	CONSTRAINT "events_title_len" CHECK (char_length("events"."title") between 2 and 140),
	CONSTRAINT "events_dates_order" CHECK ("events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_doors_before_start" CHECK ("events"."doors_at" is null or "events"."doors_at" <= "events"."starts_at"),
	CONSTRAINT "events_capacity_nonneg" CHECK ("events"."capacity" >= 0),
	CONSTRAINT "events_version_pos" CHECK ("events"."version" >= 1),
	CONSTRAINT "events_cancel_reason" CHECK ("events"."status" <> 'cancelled' or "events"."cancellation_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "form_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid,
	"purpose" "form_purpose" NOT NULL,
	"title" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_definitions_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"type" "form_field_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_fields_key_format" CHECK ("form_fields"."key" ~ '^[a-z][a-z0-9_]{0,60}$')
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"visibility" "stored_file_visibility" DEFAULT 'private' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_size_nonneg" CHECK ("stored_files"."size_bytes" >= 0),
	CONSTRAINT "stored_files_mime_format" CHECK ("stored_files"."mime_type" ~ '^[a-z]+/[a-z0-9.+-]+$')
);
--> statement-breakpoint
ALTER TABLE "event_locations" ADD CONSTRAINT "event_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_settings" ADD CONSTRAINT "event_settings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_settings" ADD CONSTRAINT "event_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_settings" ADD CONSTRAINT "event_settings_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."event_locations"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_field_id_form_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."form_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_fk" FOREIGN KEY ("organization_id","form_id") REFERENCES "public"."form_definitions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_fk" FOREIGN KEY ("organization_id","form_id") REFERENCES "public"."form_definitions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_locations_org_idx" ON "event_locations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_media_poster_uq" ON "event_media" USING btree ("event_id") WHERE "event_media"."role" = 'poster';--> statement-breakpoint
CREATE INDEX "event_media_event_idx" ON "event_media" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_org_slug_uq" ON "events" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "events_org_status_starts_idx" ON "events" USING btree ("organization_id","status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "form_answers_submission_field_uq" ON "form_answers" USING btree ("submission_id","field_id");--> statement-breakpoint
CREATE INDEX "form_definitions_event_idx" ON "form_definitions" USING btree ("event_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "form_fields_form_key_uq" ON "form_fields" USING btree ("form_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submissions_subject_uq" ON "form_submissions" USING btree ("form_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_bucket_key_uq" ON "stored_files" USING btree ("bucket","object_key");--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD CONSTRAINT "member_role_assignments_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;