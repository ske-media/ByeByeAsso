CREATE TYPE "public"."consent_basis" AS ENUM('explicit_opt_in', 'customer_exception', 'manual', 'import');--> statement-breakpoint
CREATE TYPE "public"."consent_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."contact_identity_kind" AS ENUM('email', 'phone', 'user');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('active', 'merged', 'archived');--> statement-breakpoint
CREATE TYPE "public"."crm_source" AS ENUM('order', 'membership', 'volunteer_application', 'schedule', 'staff', 'public_form', 'import', 'system');--> statement-breakpoint
CREATE TYPE "public"."marketing_email_status" AS ENUM('none', 'opted_in', 'customer_only', 'withdrawn', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."segment_kind" AS ENUM('dynamic', 'static');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('unsubscribed', 'bounced', 'complaint', 'manual', 'erased');--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "consent_channel" DEFAULT 'email' NOT NULL,
	"status" "consent_status" NOT NULL,
	"basis" "consent_basis" NOT NULL,
	"source" "crm_source" NOT NULL,
	"source_id" uuid,
	"evidence" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_records_evidence_length" CHECK (char_length("consent_records"."evidence") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "contact_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "contact_identity_kind" NOT NULL,
	"value" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" "crm_source" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_identities_value_nonempty" CHECK (char_length("contact_identities"."value") >= 1),
	CONSTRAINT "contact_identities_email_lower" CHECK ("contact_identities"."kind" <> 'email' or "contact_identities"."value" = lower("contact_identities"."value"))
);
--> statement-breakpoint
CREATE TABLE "contact_merge_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"surviving_contact_id" uuid NOT NULL,
	"merged_contact_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text,
	"merged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_merge_records_distinct" CHECK ("contact_merge_records"."surviving_contact_id" <> "contact_merge_records"."merged_contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_notes_body_length" CHECK (char_length("contact_notes"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "contact_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source" "crm_source" DEFAULT 'staff' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	"lift_reason" text,
	CONSTRAINT "contact_suppressions_email_lower" CHECK ("contact_suppressions"."email" = lower("contact_suppressions"."email")),
	CONSTRAINT "contact_suppressions_lift_reason" CHECK ("contact_suppressions"."lifted_at" is null or ("contact_suppressions"."lift_reason" is not null and char_length("contact_suppressions"."lift_reason") >= 3))
);
--> statement-breakpoint
CREATE TABLE "contact_tag_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT 'lime' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_tags_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "contact_tags_slug_format" CHECK ("contact_tags"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "contact_tags_name_length" CHECK (char_length("contact_tags"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"primary_email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"city" text,
	"user_id" uuid,
	"status" "contact_status" DEFAULT 'active' NOT NULL,
	"merged_into_contact_id" uuid,
	"source" "crm_source" DEFAULT 'staff' NOT NULL,
	"marketing_email_status" "marketing_email_status" DEFAULT 'none' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"tickets_count" integer DEFAULT 0 NOT NULL,
	"memberships_count" integer DEFAULT 0 NOT NULL,
	"applications_count" integer DEFAULT 0 NOT NULL,
	"missions_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "contacts_email_lower" CHECK ("contacts"."primary_email" = lower("contacts"."primary_email")),
	CONSTRAINT "contacts_email_format" CHECK ("contacts"."primary_email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
	CONSTRAINT "contacts_merged_target" CHECK (("contacts"."status" = 'merged') = ("contacts"."merged_into_contact_id" is not null)),
	CONSTRAINT "contacts_archived_at" CHECK (("contacts"."status" = 'archived') = ("contacts"."archived_at" is not null)),
	CONSTRAINT "contacts_counters_nonneg" CHECK ("contacts"."orders_count" >= 0 and "contacts"."tickets_count" >= 0 and "contacts"."memberships_count" >= 0 and "contacts"."applications_count" >= 0 and "contacts"."missions_count" >= 0),
	CONSTRAINT "contacts_version_pos" CHECK ("contacts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "segment_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"kind" "segment_kind" DEFAULT 'dynamic' NOT NULL,
	"definition" jsonb DEFAULT '{"rules":[]}'::jsonb NOT NULL,
	"member_count" integer,
	"computed_at" timestamp with time zone,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "segments_slug_format" CHECK ("segments"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "segments_name_length" CHECK (char_length("segments"."name") between 1 and 120),
	CONSTRAINT "segments_version_pos" CHECK ("segments"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_records" ADD CONSTRAINT "contact_merge_records_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_records" ADD CONSTRAINT "contact_merge_records_surviving_fk" FOREIGN KEY ("organization_id","surviving_contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_records" ADD CONSTRAINT "contact_merge_records_merged_fk" FOREIGN KEY ("organization_id","merged_contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_lifted_by_users_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag_assignments" ADD CONSTRAINT "contact_tag_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag_assignments" ADD CONSTRAINT "contact_tag_assignments_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag_assignments" ADD CONSTRAINT "contact_tag_assignments_tag_fk" FOREIGN KEY ("organization_id","tag_id") REFERENCES "public"."contact_tags"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_merged_into_fk" FOREIGN KEY ("organization_id","merged_into_contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_segment_fk" FOREIGN KEY ("organization_id","segment_id") REFERENCES "public"."segments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_contact_idx" ON "consent_records" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_records_source_uq" ON "consent_records" USING btree ("organization_id","source","source_id","status") WHERE "consent_records"."source_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_org_kind_value_uq" ON "contact_identities" USING btree ("organization_id","kind","value") WHERE "contact_identities"."kind" <> 'phone';--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_contact_kind_value_uq" ON "contact_identities" USING btree ("contact_id","kind","value");--> statement-breakpoint
CREATE INDEX "contact_identities_org_value_idx" ON "contact_identities" USING btree ("organization_id","kind","value");--> statement-breakpoint
CREATE INDEX "contact_identities_contact_idx" ON "contact_identities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_merge_records_surviving_idx" ON "contact_merge_records" USING btree ("surviving_contact_id");--> statement-breakpoint
CREATE INDEX "contact_notes_contact_idx" ON "contact_notes" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_suppressions_active_uq" ON "contact_suppressions" USING btree ("organization_id","email") WHERE "contact_suppressions"."lifted_at" is null;--> statement-breakpoint
CREATE INDEX "contact_suppressions_org_idx" ON "contact_suppressions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tag_assignments_uq" ON "contact_tag_assignments" USING btree ("contact_id","tag_id");--> statement-breakpoint
CREATE INDEX "contact_tag_assignments_tag_idx" ON "contact_tag_assignments" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tags_org_slug_uq" ON "contact_tags" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_email_active_uq" ON "contacts" USING btree ("organization_id","primary_email") WHERE "contacts"."status" = 'active';--> statement-breakpoint
CREATE INDEX "contacts_org_status_idx" ON "contacts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "contacts_org_activity_idx" ON "contacts" USING btree ("organization_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "contacts_user_idx" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_members_uq" ON "segment_members" USING btree ("segment_id","contact_id");--> statement-breakpoint
CREATE INDEX "segment_members_contact_idx" ON "segment_members" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_org_slug_uq" ON "segments" USING btree ("organization_id","slug");--> statement-breakpoint
INSERT INTO "permissions" ("key", "description") VALUES
  ('contacts.manage', 'Gérer les contacts : fiches, tags, notes, consentements, exclusions, segments, fusions')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM (VALUES
  ('owner', 'contacts.manage'),
  ('organization_admin', 'contacts.manage'),
  ('event_manager', 'contacts.manage'),
  ('marketing_manager', 'contacts.manage'),
  ('ticketing_manager', 'contacts.manage')
) AS m("role_key", "permission_key")
JOIN "roles" r ON r."key" = m."role_key" AND r."organization_id" IS NULL
JOIN "permissions" p ON p."key" = m."permission_key"
ON CONFLICT DO NOTHING;
