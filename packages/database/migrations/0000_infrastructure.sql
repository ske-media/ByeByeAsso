CREATE TYPE "public"."job_execution_status" AS ENUM('running', 'succeeded', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'dispatched', 'failed');--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_format" CHECK ("feature_flags"."key" ~ '^[a-z0-9_.-]{2,80}$')
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"response_status" integer,
	"response" jsonb,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_key_len" CHECK (char_length("idempotency_records"."key") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "job_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"job_id" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "job_execution_status" DEFAULT 'running' NOT NULL,
	"organization_id" text,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	CONSTRAINT "job_executions_attempt_pos" CHECK ("job_executions"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"organization_id" text,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_attempts_nonneg" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_key_global_uq" ON "feature_flags" USING btree ("key") WHERE "feature_flags"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_key_org_uq" ON "feature_flags" USING btree ("key","organization_id") WHERE "feature_flags"."organization_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_scope_key_uq" ON "idempotency_records" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_executions_job_attempt_uq" ON "job_executions" USING btree ("job_id","attempt");--> statement-breakpoint
CREATE INDEX "job_executions_queue_started_idx" ON "job_executions" USING btree ("queue","started_at");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");