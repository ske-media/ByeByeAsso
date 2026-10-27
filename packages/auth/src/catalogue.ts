/**
 * @kroov/auth — Phase 0 boundary.
 *
 * Phase 1 will add:
 * - Better Auth configuration (email + password, e-mail verification, password reset,
 *   magic links for attendees/volunteers), sessions stored in PostgreSQL via Drizzle.
 * - `requireUser()` / `requirePermission()` helpers used by every route handler and
 *   server action, enforcing deny-by-default RBAC at organization and event scope.
 *
 * The permission catalogue is declared here already so UI, tests and the Phase 1
 * seed share one source of truth.
 */

export const PERMISSIONS = [
  "organization.read",
  "organization.manage",
  "billing.manage",
  "members.invite",
  "members.manage",
  "events.create",
  "events.read",
  "events.update",
  "events.publish",
  "events.cancel",
  "tickets.manage",
  "orders.read",
  "orders.refund",
  "checkins.scan",
  "memberships.manage",
  "volunteers.review",
  "volunteers.schedule",
  "schedules.publish",
  "contacts.read",
  "contacts.export",
  "campaigns.manage",
  "campaigns.send",
  "analytics.read",
  "tasks.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  "owner",
  "organization_admin",
  "event_manager",
  "volunteer_manager",
  "marketing_manager",
  "ticketing_manager",
  "scanner",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Default role → permission grants. Seeded into `role_permissions` in Phase 1 and
 * editable per organization afterwards. Deny by default: anything not listed is refused.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: [...PERMISSIONS],
  organization_admin: PERMISSIONS.filter((p) => p !== "billing.manage"),
  event_manager: [
    "organization.read",
    "events.create",
    "events.read",
    "events.update",
    "events.publish",
    "events.cancel",
    "tickets.manage",
    "orders.read",
    "checkins.scan",
    "volunteers.review",
    "volunteers.schedule",
    "schedules.publish",
    "contacts.read",
    "campaigns.manage",
    "campaigns.send",
    "analytics.read",
    "tasks.manage",
  ],
  volunteer_manager: [
    "organization.read",
    "events.read",
    "volunteers.review",
    "volunteers.schedule",
    "schedules.publish",
    "contacts.read",
    "tasks.manage",
  ],
  marketing_manager: [
    "organization.read",
    "events.read",
    "contacts.read",
    "campaigns.manage",
    "campaigns.send",
    "analytics.read",
  ],
  ticketing_manager: [
    "organization.read",
    "events.read",
    "tickets.manage",
    "orders.read",
    "orders.refund",
    "checkins.scan",
    "memberships.manage",
    "contacts.read",
    "contacts.export",
    "analytics.read",
  ],
  scanner: ["events.read", "checkins.scan"],
};
