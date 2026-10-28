CREATE TYPE "public"."membership_application_status" AS ENUM('submitted', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."membership_entitlement_kind" AS ENUM('member_ticket_eligibility', 'benefit');--> statement-breakpoint
CREATE TYPE "public"."membership_period_kind" AS ENUM('fixed', 'rolling');--> statement-breakpoint
CREATE TYPE "public"."membership_plan_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('pending', 'awaiting_payment', 'active', 'rejected', 'suspended', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "membership_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"user_id" uuid,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"status" "membership_application_status" DEFAULT 'submitted' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_applications_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "membership_applications_email_lower" CHECK ("membership_applications"."email" = lower("membership_applications"."email")),
	CONSTRAINT "membership_applications_rejection" CHECK ("membership_applications"."status" <> 'rejected' or "membership_applications"."rejection_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "membership_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" "membership_entitlement_kind" NOT NULL,
	"key" text DEFAULT 'default' NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_entitlements_validity" CHECK ("membership_entitlements"."valid_until" > "membership_entitlements"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "membership_plan_benefits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "membership_plan_benefits_label_len" CHECK (char_length("membership_plan_benefits"."label") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"period_kind" "membership_period_kind" DEFAULT 'fixed' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"duration_months" integer,
	"requires_review" boolean DEFAULT false NOT NULL,
	"max_members" integer,
	"public" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "membership_plan_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "membership_plans_name_len" CHECK (char_length("membership_plans"."name") between 2 and 120),
	CONSTRAINT "membership_plans_slug_format" CHECK ("membership_plans"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'),
	CONSTRAINT "membership_plans_price_nonneg" CHECK ("membership_plans"."price_minor" >= 0),
	CONSTRAINT "membership_plans_max_members" CHECK ("membership_plans"."max_members" is null or "membership_plans"."max_members" >= 1),
	CONSTRAINT "membership_plans_period" CHECK (("membership_plans"."period_kind" = 'fixed' and "membership_plans"."valid_from" is not null and "membership_plans"."valid_until" is not null and "membership_plans"."valid_until" > "membership_plans"."valid_from") or ("membership_plans"."period_kind" = 'rolling' and "membership_plans"."duration_months" between 1 and 60))
);
--> statement-breakpoint
CREATE TABLE "membership_validity_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"previous_valid_from" timestamp with time zone,
	"previous_valid_until" timestamp with time zone,
	"new_valid_from" timestamp with time zone,
	"new_valid_until" timestamp with time zone,
	"reason" text,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_validity_changes_kind" CHECK ("membership_validity_changes"."kind" ~ '^[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"application_id" uuid,
	"number" text NOT NULL,
	"member_email" text NOT NULL,
	"member_first_name" text NOT NULL,
	"member_last_name" text NOT NULL,
	"user_id" uuid,
	"status" "membership_status" DEFAULT 'pending' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"renewed_from" uuid,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"access_token_hash" text NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"reminder_sent_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "memberships_email_lower" CHECK ("memberships"."member_email" = lower("memberships"."member_email")),
	CONSTRAINT "memberships_validity" CHECK ("memberships"."valid_from" is null or "memberships"."valid_until" is null or "memberships"."valid_until" > "memberships"."valid_from"),
	CONSTRAINT "memberships_active_has_validity" CHECK ("memberships"."status" not in ('active','suspended','expired') or ("memberships"."valid_from" is not null and "memberships"."valid_until" is not null)),
	CONSTRAINT "memberships_price_nonneg" CHECK ("memberships"."price_minor" >= 0),
	CONSTRAINT "memberships_cancel_reason" CHECK ("memberships"."status" <> 'cancelled' or "memberships"."cancellation_reason" is not null),
	CONSTRAINT "memberships_version_pos" CHECK ("memberships"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "membership_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD COLUMN "members_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_applications" ADD CONSTRAINT "membership_applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_applications" ADD CONSTRAINT "membership_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_applications" ADD CONSTRAINT "membership_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_applications" ADD CONSTRAINT "membership_applications_plan_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "public"."membership_plans"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_entitlements" ADD CONSTRAINT "membership_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_entitlements" ADD CONSTRAINT "membership_entitlements_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_benefits" ADD CONSTRAINT "membership_plan_benefits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_benefits" ADD CONSTRAINT "membership_plan_benefits_plan_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "public"."membership_plans"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_validity_changes" ADD CONSTRAINT "membership_validity_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_validity_changes" ADD CONSTRAINT "membership_validity_changes_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_plan_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "public"."membership_plans"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."membership_applications"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_renewed_from_fk" FOREIGN KEY ("organization_id","renewed_from") REFERENCES "public"."memberships"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_applications_org_status_idx" ON "membership_applications" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_entitlements_uq" ON "membership_entitlements" USING btree ("membership_id","kind","key");--> statement-breakpoint
CREATE INDEX "membership_plan_benefits_plan_idx" ON "membership_plan_benefits" USING btree ("plan_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_plans_org_slug_uq" ON "membership_plans" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "membership_validity_changes_membership_idx" ON "membership_validity_changes" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_number_uq" ON "memberships" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_access_token_uq" ON "memberships" USING btree ("access_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_active_email_uq" ON "memberships" USING btree ("organization_id","member_email") WHERE "memberships"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_active_user_uq" ON "memberships" USING btree ("organization_id","user_id") WHERE "memberships"."status" = 'active' and "memberships"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "memberships_org_status_idx" ON "memberships" USING btree ("organization_id","status","valid_until");--> statement-breakpoint
CREATE INDEX "memberships_email_idx" ON "memberships" USING btree ("member_email");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");