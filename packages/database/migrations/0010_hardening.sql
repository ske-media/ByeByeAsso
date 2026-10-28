CREATE TABLE "request_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"subject" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_rate_limits_count_nonneg" CHECK ("request_rate_limits"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "request_rate_limits_uq" ON "request_rate_limits" USING btree ("scope","subject","window_start");--> statement-breakpoint
CREATE INDEX "request_rate_limits_window_idx" ON "request_rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "orders_org_status_paid_idx" ON "orders" USING btree ("organization_id","status","paid_at");--> statement-breakpoint
CREATE INDEX "refunds_org_status_idx" ON "refunds" USING btree ("organization_id","status","succeeded_at");--> statement-breakpoint
CREATE INDEX "tickets_org_status_idx" ON "tickets" USING btree ("organization_id","status");