/**
 * Drizzle schema root. Every domain adds its own file here; drizzle-kit reads this
 * module to generate SQL migrations.
 *
 * Phase 0: infrastructure. Phase 1: auth (Better Auth) + identity. Phase 2: events.
 */
export * from "./auth";
export * from "./events";
export * from "./identity";
export * from "./infrastructure";
