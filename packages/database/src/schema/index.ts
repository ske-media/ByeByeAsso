/**
 * Drizzle schema root. Every domain adds its own file here; drizzle-kit reads this
 * module to generate SQL migrations.
 *
 * Phase 0: infrastructure. Phase 1: auth (Better Auth) + identity. Phase 2: events. Phase 3: ticketing + payments. Phase 4: memberships. Phase 5: volunteers. Phase 6: scheduling. Phase 7: crm.
 */
export * from "./auth";
export * from "./crm";
export * from "./events";
export * from "./identity";
export * from "./infrastructure";
export * from "./memberships";
export * from "./scheduling";
export * from "./ticketing";
export * from "./volunteers";
