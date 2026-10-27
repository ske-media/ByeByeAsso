/**
 * Drizzle schema root. Every domain adds its own file here; drizzle-kit reads this
 * module to generate SQL migrations.
 *
 * Phase 0: infrastructure tables only.
 * Phase 1: identity (user_profiles, organizations, members, roles, permissions, audit_logs).
 */
export * from "./infrastructure";
