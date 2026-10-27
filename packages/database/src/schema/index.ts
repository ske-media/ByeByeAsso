/**
 * Drizzle schema root. Every domain adds its own file here; drizzle-kit reads this
 * module to generate SQL migrations.
 *
 * Phase 0: infrastructure. Phase 1: auth (Better Auth) + identity.
 */
export * from "./auth";
export * from "./identity";
export * from "./infrastructure";
