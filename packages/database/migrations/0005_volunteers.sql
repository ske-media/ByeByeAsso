CREATE TYPE "public"."volunteer_recruitment_status" AS ENUM('closed', 'open');--> statement-breakpoint
CREATE TYPE "public"."volunteer_availability_kind" AS ENUM('available', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."volunteer_catalogue_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."volunteer_skill_level" AS ENUM('beginner', 'intermediate', 'expert');--> statement-breakpoint
CREATE TYPE "public"."volunteer_application_status" AS ENUM('submitted', 'under_review', 'approved', 'waitlisted', 'rejected', 'assigned', 'confirmed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."volunteer_shift_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TABLE "event_volunteer_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"briefing" text,
	"status" "volunteer_catalogue_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_volunteer_positions_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "position_required_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"requires_verification" boolean DEFAULT false NOT NULL,
	"status" "volunteer_catalogue_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "skills_name_len" CHECK (char_length("skills"."name") between 2 and 80),
	CONSTRAINT "skills_slug_format" CHECK ("skills"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$')
);
--> statement-breakpoint
CREATE TABLE "volunteer_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"number" text NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"user_id" uuid,
	"birth_year" integer,
	"motivation" text,
	"experience" text,
	"constraints" text,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"status" "volunteer_application_status" DEFAULT 'submitted' NOT NULL,
	"decision_reason" text,
	"internal_notes" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"access_token_hash" text NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_applications_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "volunteer_applications_email_lower" CHECK ("volunteer_applications"."email" = lower("volunteer_applications"."email")),
	CONSTRAINT "volunteer_applications_names" CHECK (char_length("volunteer_applications"."first_name") >= 1 and char_length("volunteer_applications"."last_name") >= 1),
	CONSTRAINT "volunteer_applications_birth_year" CHECK ("volunteer_applications"."birth_year" is null or "volunteer_applications"."birth_year" between 1900 and 2030),
	CONSTRAINT "volunteer_applications_rejection" CHECK ("volunteer_applications"."status" <> 'rejected' or "volunteer_applications"."decision_reason" is not null),
	CONSTRAINT "volunteer_applications_version_pos" CHECK ("volunteer_applications"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "volunteer_availabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" "volunteer_availability_kind" DEFAULT 'available' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	CONSTRAINT "volunteer_availabilities_range" CHECK ("volunteer_availabilities"."ends_at" > "volunteer_availabilities"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "volunteer_position_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "volunteer_position_preferences_rank_pos" CHECK ("volunteer_position_preferences"."rank" >= 1)
);
--> statement-breakpoint
CREATE TABLE "volunteer_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instructions" text,
	"min_age" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "volunteer_catalogue_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_positions_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "volunteer_positions_name_len" CHECK (char_length("volunteer_positions"."name") between 2 and 80),
	CONSTRAINT "volunteer_positions_slug_format" CHECK ("volunteer_positions"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'),
	CONSTRAINT "volunteer_positions_min_age" CHECK ("volunteer_positions"."min_age" is null or "volunteer_positions"."min_age" between 14 and 99)
);
--> statement-breakpoint
CREATE TABLE "volunteer_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_position_id" uuid NOT NULL,
	"label" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"required_count" integer DEFAULT 1 NOT NULL,
	"max_count" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"status" "volunteer_shift_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_shifts_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "volunteer_shifts_range" CHECK ("volunteer_shifts"."ends_at" > "volunteer_shifts"."starts_at"),
	CONSTRAINT "volunteer_shifts_counts" CHECK ("volunteer_shifts"."required_count" >= 0 and "volunteer_shifts"."max_count" >= "volunteer_shifts"."required_count"),
	CONSTRAINT "volunteer_shifts_max_duration" CHECK ("volunteer_shifts"."ends_at" - "volunteer_shifts"."starts_at" <= interval '24 hours')
);
--> statement-breakpoint
CREATE TABLE "volunteer_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" "volunteer_skill_level",
	"verified" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "volunteer_social_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"target_email" text NOT NULL,
	"target_application_id" uuid,
	"reciprocal" boolean DEFAULT false NOT NULL,
	"invited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_social_preferences_email_lower" CHECK ("volunteer_social_preferences"."target_email" = lower("volunteer_social_preferences"."target_email"))
);
--> statement-breakpoint
CREATE TABLE "volunteer_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT 'lavender' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "volunteer_catalogue_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_teams_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "volunteer_teams_name_len" CHECK (char_length("volunteer_teams"."name") between 2 and 80),
	CONSTRAINT "volunteer_teams_slug_format" CHECK ("volunteer_teams"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$')
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "volunteer_recruitment_status" "volunteer_recruitment_status" DEFAULT 'closed' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "volunteer_target_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "volunteer_max_hours" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "volunteer_min_rest_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteer_positions" ADD CONSTRAINT "event_volunteer_positions_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_positions" ADD CONSTRAINT "event_volunteer_positions_position_fk" FOREIGN KEY ("organization_id","position_id") REFERENCES "public"."volunteer_positions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_required_skills" ADD CONSTRAINT "position_required_skills_position_fk" FOREIGN KEY ("organization_id","position_id") REFERENCES "public"."volunteer_positions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_required_skills" ADD CONSTRAINT "position_required_skills_skill_fk" FOREIGN KEY ("organization_id","skill_id") REFERENCES "public"."skills"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_applications" ADD CONSTRAINT "volunteer_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_applications" ADD CONSTRAINT "volunteer_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_applications" ADD CONSTRAINT "volunteer_applications_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_availabilities" ADD CONSTRAINT "volunteer_availabilities_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."volunteer_applications"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_position_preferences" ADD CONSTRAINT "volunteer_position_preferences_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."volunteer_applications"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_position_preferences" ADD CONSTRAINT "volunteer_position_preferences_position_fk" FOREIGN KEY ("organization_id","position_id") REFERENCES "public"."volunteer_positions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_positions" ADD CONSTRAINT "volunteer_positions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_positions" ADD CONSTRAINT "volunteer_positions_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."volunteer_teams"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD CONSTRAINT "volunteer_shifts_event_position_fk" FOREIGN KEY ("organization_id","event_position_id") REFERENCES "public"."event_volunteer_positions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD CONSTRAINT "volunteer_shifts_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_skills" ADD CONSTRAINT "volunteer_skills_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_skills" ADD CONSTRAINT "volunteer_skills_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."volunteer_applications"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_skills" ADD CONSTRAINT "volunteer_skills_skill_fk" FOREIGN KEY ("organization_id","skill_id") REFERENCES "public"."skills"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_social_preferences" ADD CONSTRAINT "volunteer_social_preferences_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."volunteer_applications"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_social_preferences" ADD CONSTRAINT "volunteer_social_preferences_target_fk" FOREIGN KEY ("organization_id","target_application_id") REFERENCES "public"."volunteer_applications"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_teams" ADD CONSTRAINT "volunteer_teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_volunteer_positions_uq" ON "event_volunteer_positions" USING btree ("event_id","position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "position_required_skills_uq" ON "position_required_skills" USING btree ("position_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_org_slug_uq" ON "skills" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_applications_org_number_uq" ON "volunteer_applications" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_applications_access_token_uq" ON "volunteer_applications" USING btree ("access_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_applications_live_uq" ON "volunteer_applications" USING btree ("event_id","email") WHERE "volunteer_applications"."status" not in ('rejected', 'withdrawn');--> statement-breakpoint
CREATE INDEX "volunteer_applications_event_status_idx" ON "volunteer_applications" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "volunteer_applications_email_idx" ON "volunteer_applications" USING btree ("email");--> statement-breakpoint
CREATE INDEX "volunteer_applications_user_idx" ON "volunteer_applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "volunteer_availabilities_application_idx" ON "volunteer_availabilities" USING btree ("application_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_position_preferences_position_uq" ON "volunteer_position_preferences" USING btree ("application_id","position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_position_preferences_rank_uq" ON "volunteer_position_preferences" USING btree ("application_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_positions_org_slug_uq" ON "volunteer_positions" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "volunteer_shifts_event_idx" ON "volunteer_shifts" USING btree ("event_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_skills_uq" ON "volunteer_skills" USING btree ("application_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_social_preferences_uq" ON "volunteer_social_preferences" USING btree ("application_id","target_email");--> statement-breakpoint
CREATE INDEX "volunteer_social_preferences_target_idx" ON "volunteer_social_preferences" USING btree ("target_email");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_teams_org_slug_uq" ON "volunteer_teams" USING btree ("organization_id","slug");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_volunteer_settings" CHECK ("events"."volunteer_target_count" >= 0 and "events"."volunteer_max_hours" between 0 and 24 and "events"."volunteer_min_rest_minutes" between 0 and 1440);