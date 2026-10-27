CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."organization_legal_form" AS ENUM('association', 'company', 'collective', 'public_body', 'other');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_kind" CHECK ("audit_logs"."actor_kind" in ('user','system','webhook','anonymous')),
	CONSTRAINT "audit_logs_action_format" CHECK ("audit_logs"."action" ~ '^[a-z_]+\.[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "member_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"event_id" uuid,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"event_id" uuid,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invitations_email_lower" CHECK ("organization_invitations"."email" = lower("organization_invitations"."email"))
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"locale" text DEFAULT 'fr-FR' NOT NULL,
	"contact_email" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_currency_upper" CHECK ("organization_settings"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"legal_form" "organization_legal_form" DEFAULT 'association' NOT NULL,
	"country" char(2) DEFAULT 'FR' NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_format" CHECK ("organizations"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'),
	CONSTRAINT "organizations_name_len" CHECK (char_length("organizations"."name") between 2 and 120),
	CONSTRAINT "organizations_country_upper" CHECK ("organizations"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "permissions_key_format" CHECK ("permissions"."key" ~ '^[a-z]+\.[a-z]+$')
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_format" CHECK ("roles"."key" ~ '^[a-z][a-z0-9_]{1,40}$')
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'fr-FR' NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_locale_format" CHECK ("user_profiles"."locale" ~ '^[a-z]{2}(-[A-Z]{2})?$')
);
--> statement-breakpoint
ALTER TABLE "feature_flags" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "job_executions" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD CONSTRAINT "member_role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD CONSTRAINT "member_role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD CONSTRAINT "member_role_assignments_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "public"."organization_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_key_uq" ON "rate_limits" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_role_assignments_org_scope_uq" ON "member_role_assignments" USING btree ("member_id","role_id") WHERE "member_role_assignments"."event_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "member_role_assignments_event_scope_uq" ON "member_role_assignments" USING btree ("member_id","role_id","event_id") WHERE "member_role_assignments"."event_id" is not null;--> statement-breakpoint
CREATE INDEX "member_role_assignments_org_idx" ON "member_role_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_token_hash_uq" ON "organization_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_pending_email_uq" ON "organization_invitations" USING btree ("organization_id","email") WHERE "organization_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "organization_invitations_org_idx" ON "organization_invitations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_active_uq" ON "organization_members" USING btree ("organization_id","user_id") WHERE "organization_members"."status" = 'active';--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_uq" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_key_uq" ON "roles" USING btree ("key") WHERE "roles"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_key_uq" ON "roles" USING btree ("organization_id","key") WHERE "roles"."organization_id" is not null;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_executions" ADD CONSTRAINT "job_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
-- Seed: permission catalogue, system roles and default matrix (idempotent).
INSERT INTO "permissions" ("key", "description") VALUES
  ('organization.read', 'Lire les informations de l''organisation'),
  ('organization.manage', 'Modifier l''organisation et ses réglages'),
  ('billing.manage', 'Gérer l''abonnement et les coordonnées bancaires'),
  ('members.invite', 'Inviter des collaborateurs'),
  ('members.manage', 'Modifier les rôles et retirer des collaborateurs'),
  ('events.create', 'Créer des événements'),
  ('events.read', 'Consulter les événements'),
  ('events.update', 'Modifier des événements'),
  ('events.publish', 'Publier des événements'),
  ('events.cancel', 'Annuler des événements'),
  ('tickets.manage', 'Configurer la billetterie'),
  ('orders.read', 'Consulter commandes et participants'),
  ('orders.refund', 'Rembourser'),
  ('checkins.scan', 'Scanner des billets'),
  ('memberships.manage', 'Gérer les adhésions'),
  ('volunteers.review', 'Examiner les candidatures bénévoles'),
  ('volunteers.schedule', 'Proposer et modifier le planning'),
  ('schedules.publish', 'Publier le planning'),
  ('contacts.read', 'Consulter les contacts'),
  ('contacts.export', 'Exporter les contacts'),
  ('campaigns.manage', 'Préparer des campagnes'),
  ('campaigns.send', 'Envoyer des campagnes'),
  ('analytics.read', 'Consulter les statistiques'),
  ('tasks.manage', 'Gérer les tâches')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";--> statement-breakpoint
INSERT INTO "roles" ("key", "name", "description", "is_system") VALUES
  ('owner', 'Propriétaire', 'Contrôle total de l''organisation, de l''abonnement et des coordonnées bancaires.', true),
  ('organization_admin', 'Administrateur', 'Gère tout sauf l''abonnement et les coordonnées bancaires.', true),
  ('event_manager', 'Responsable événement', 'Crée, modifie et publie les événements de son périmètre.', true),
  ('volunteer_manager', 'Responsable bénévoles', 'Examine les candidatures et pilote le planning.', true),
  ('marketing_manager', 'Marketing', 'Segments, campagnes et envois.', true),
  ('ticketing_manager', 'Billetterie et finances', 'Commandes, remboursements, adhésions, exports.', true),
  ('scanner', 'Contrôle d''accès', 'Scanne les billets de l''événement attribué.', true)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM (VALUES
  ('owner', 'organization.read'),
  ('owner', 'organization.manage'),
  ('owner', 'billing.manage'),
  ('owner', 'members.invite'),
  ('owner', 'members.manage'),
  ('owner', 'events.create'),
  ('owner', 'events.read'),
  ('owner', 'events.update'),
  ('owner', 'events.publish'),
  ('owner', 'events.cancel'),
  ('owner', 'tickets.manage'),
  ('owner', 'orders.read'),
  ('owner', 'orders.refund'),
  ('owner', 'checkins.scan'),
  ('owner', 'memberships.manage'),
  ('owner', 'volunteers.review'),
  ('owner', 'volunteers.schedule'),
  ('owner', 'schedules.publish'),
  ('owner', 'contacts.read'),
  ('owner', 'contacts.export'),
  ('owner', 'campaigns.manage'),
  ('owner', 'campaigns.send'),
  ('owner', 'analytics.read'),
  ('owner', 'tasks.manage'),
  ('organization_admin', 'organization.read'),
  ('organization_admin', 'organization.manage'),
  ('organization_admin', 'members.invite'),
  ('organization_admin', 'members.manage'),
  ('organization_admin', 'events.create'),
  ('organization_admin', 'events.read'),
  ('organization_admin', 'events.update'),
  ('organization_admin', 'events.publish'),
  ('organization_admin', 'events.cancel'),
  ('organization_admin', 'tickets.manage'),
  ('organization_admin', 'orders.read'),
  ('organization_admin', 'orders.refund'),
  ('organization_admin', 'checkins.scan'),
  ('organization_admin', 'memberships.manage'),
  ('organization_admin', 'volunteers.review'),
  ('organization_admin', 'volunteers.schedule'),
  ('organization_admin', 'schedules.publish'),
  ('organization_admin', 'contacts.read'),
  ('organization_admin', 'contacts.export'),
  ('organization_admin', 'campaigns.manage'),
  ('organization_admin', 'campaigns.send'),
  ('organization_admin', 'analytics.read'),
  ('organization_admin', 'tasks.manage'),
  ('event_manager', 'organization.read'),
  ('event_manager', 'events.create'),
  ('event_manager', 'events.read'),
  ('event_manager', 'events.update'),
  ('event_manager', 'events.publish'),
  ('event_manager', 'events.cancel'),
  ('event_manager', 'tickets.manage'),
  ('event_manager', 'orders.read'),
  ('event_manager', 'checkins.scan'),
  ('event_manager', 'volunteers.review'),
  ('event_manager', 'volunteers.schedule'),
  ('event_manager', 'schedules.publish'),
  ('event_manager', 'contacts.read'),
  ('event_manager', 'campaigns.manage'),
  ('event_manager', 'campaigns.send'),
  ('event_manager', 'analytics.read'),
  ('event_manager', 'tasks.manage'),
  ('volunteer_manager', 'organization.read'),
  ('volunteer_manager', 'events.read'),
  ('volunteer_manager', 'volunteers.review'),
  ('volunteer_manager', 'volunteers.schedule'),
  ('volunteer_manager', 'schedules.publish'),
  ('volunteer_manager', 'contacts.read'),
  ('volunteer_manager', 'tasks.manage'),
  ('marketing_manager', 'organization.read'),
  ('marketing_manager', 'events.read'),
  ('marketing_manager', 'contacts.read'),
  ('marketing_manager', 'campaigns.manage'),
  ('marketing_manager', 'campaigns.send'),
  ('marketing_manager', 'analytics.read'),
  ('ticketing_manager', 'organization.read'),
  ('ticketing_manager', 'events.read'),
  ('ticketing_manager', 'tickets.manage'),
  ('ticketing_manager', 'orders.read'),
  ('ticketing_manager', 'orders.refund'),
  ('ticketing_manager', 'checkins.scan'),
  ('ticketing_manager', 'memberships.manage'),
  ('ticketing_manager', 'contacts.read'),
  ('ticketing_manager', 'contacts.export'),
  ('ticketing_manager', 'analytics.read'),
  ('scanner', 'events.read'),
  ('scanner', 'checkins.scan')
) AS m("role_key", "permission_key")
JOIN "roles" r ON r."key" = m."role_key" AND r."organization_id" IS NULL
JOIN "permissions" p ON p."key" = m."permission_key"
ON CONFLICT DO NOTHING;
