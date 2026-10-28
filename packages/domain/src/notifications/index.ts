/**
 * notifications module — public API (phase 9): in-app notifications for members, produced
 * by the domain-event consumer (worker) from outbox rows, with per-member preferences.
 * Each member reads and marks only their own rows.
 */
export const MODULE_NAME = "notifications" as const;

export * from "./handlers";
export * from "./notifications";
