CREATE TYPE "public"."assignment_confirmation" AS ENUM('pending', 'confirmed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."assignment_request_kind" AS ENUM('unavailable', 'replacement');--> statement-breakpoint
CREATE TYPE "public"."assignment_request_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."assignment_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'excused');--> statement-breakpoint
CREATE TYPE "public"."schedule_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."schedule_version_status" AS ENUM('draft', 'generating', 'generation_failed', 'proposed', 'under_review', 'published', 'superseded');--> statement-breakpoint
CREATE TABLE "schedule_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"algorithm_version" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"weights" jsonb NOT NULL,
	"scope" jsonb,
	"status" "schedule_run_status" DEFAULT 'running' NOT NULL,
	"covered_count" integer,
	"unfilled_count" integer,
	"diagnostics" jsonb,
	"score" jsonb,
	"solver_status" text,
	"duration_ms" integer,
	"error" text,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "schedule_generation_runs_hash" CHECK (char_length("schedule_generation_runs"."input_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "schedule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "schedule_version_status" DEFAULT 'draft' NOT NULL,
	"based_on_version_id" uuid,
	"notes" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"unfilled_acknowledged" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_versions_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "schedule_versions_number_pos" CHECK ("schedule_versions"."number" >= 1),
	CONSTRAINT "schedule_versions_version_pos" CHECK ("schedule_versions"."version" >= 1),
	CONSTRAINT "schedule_versions_published_fields" CHECK ("schedule_versions"."status" not in ('published', 'superseded') or "schedule_versions"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "volunteer_assignment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" "assignment_request_kind" DEFAULT 'unavailable' NOT NULL,
	"message" text,
	"status" "assignment_request_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volunteer_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"source" "assignment_source" DEFAULT 'auto' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"confirmation_status" "assignment_confirmation" DEFAULT 'pending' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_assignments_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "volunteer_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"status" "attendance_status" NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"note" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_attendance_times" CHECK ("volunteer_attendance"."checked_out_at" is null or "volunteer_attendance"."checked_in_at" is null or "volunteer_attendance"."checked_out_at" >= "volunteer_attendance"."checked_in_at")
);
--> statement-breakpoint
ALTER TABLE "schedule_generation_runs" ADD CONSTRAINT "schedule_generation_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_generation_runs" ADD CONSTRAINT "schedule_generation_runs_version_fk" FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."schedule_versions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_based_on_fk" FOREIGN KEY ("organization_id","based_on_version_id") REFERENCES "public"."schedule_versions"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignment_requests" ADD CONSTRAINT "volunteer_assignment_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignment_requests" ADD CONSTRAINT "volunteer_assignment_requests_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."volunteer_assignments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignment_requests" ADD CONSTRAINT "volunteer_assignment_requests_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."volunteer_applications"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_version_fk" FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."schedule_versions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_shift_fk" FOREIGN KEY ("organization_id","shift_id") REFERENCES "public"."volunteer_shifts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."volunteer_applications"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_attendance" ADD CONSTRAINT "volunteer_attendance_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_attendance" ADD CONSTRAINT "volunteer_attendance_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."volunteer_assignments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_generation_runs_event_idx" ON "schedule_generation_runs" USING btree ("event_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_versions_event_number_uq" ON "schedule_versions" USING btree ("event_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_versions_published_uq" ON "schedule_versions" USING btree ("event_id") WHERE "schedule_versions"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_assignment_requests_open_uq" ON "volunteer_assignment_requests" USING btree ("assignment_id") WHERE "volunteer_assignment_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX "volunteer_assignment_requests_event_idx" ON "volunteer_assignment_requests" USING btree ("event_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_assignments_uq" ON "volunteer_assignments" USING btree ("version_id","shift_id","application_id");--> statement-breakpoint
CREATE INDEX "volunteer_assignments_application_idx" ON "volunteer_assignments" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "volunteer_assignments_shift_idx" ON "volunteer_assignments" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_attendance_assignment_uq" ON "volunteer_attendance" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "volunteer_attendance_event_idx" ON "volunteer_attendance" USING btree ("event_id");--> statement-breakpoint
CREATE VIEW "public"."active_volunteer_commitments" AS (select "volunteer_assignments"."id", "volunteer_assignments"."organization_id", "volunteer_assignments"."event_id", "volunteer_assignments"."version_id", "volunteer_assignments"."shift_id", "volunteer_assignments"."application_id", "volunteer_assignments"."confirmation_status", "volunteer_shifts"."starts_at", "volunteer_shifts"."ends_at", "volunteer_applications"."email" from "volunteer_assignments" inner join "schedule_versions" on "schedule_versions"."id" = "volunteer_assignments"."version_id" inner join "volunteer_shifts" on "volunteer_shifts"."id" = "volunteer_assignments"."shift_id" inner join "volunteer_applications" on "volunteer_applications"."id" = "volunteer_assignments"."application_id" where "schedule_versions"."status" = 'published' and "volunteer_assignments"."confirmation_status" <> 'declined' and "volunteer_shifts"."status" = 'active');