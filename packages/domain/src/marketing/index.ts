/**
 * marketing module — public API (phase 8: campaigns, templates, dispatch, tracking, unsubscribe, attribution).
 * Other modules must import ONLY from this file. Ticketing uses `resolveAttribution` at reservation time.
 */
export const MODULE_NAME = "marketing" as const;

export * from "./campaigns";
export * from "./render";
export * from "./schemas";
export * from "./state-machine";
export * from "./webhooks";
