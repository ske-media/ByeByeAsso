/**
 * platform module — public API (phase 10): rate limiting (PostgreSQL fixed windows),
 * data retention, operational snapshot + Prometheus exposition.
 */
export const MODULE_NAME = "platform" as const;

export * from "./observability";
export * from "./rate-limit";
export * from "./retention";
