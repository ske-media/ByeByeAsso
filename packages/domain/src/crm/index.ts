/**
 * crm module — public API (phase 7: unified contacts, consent history, suppressions, segments, merges).
 * Other modules must import ONLY from this file. The only write path they use is
 * `recordTouchpoint` (called inside their own transaction) and `suppressEmail` (phase 8).
 */
export const MODULE_NAME = "crm" as const;

export * from "./contacts";
export * from "./identities";
export * from "./schemas";
export * from "./segments";
