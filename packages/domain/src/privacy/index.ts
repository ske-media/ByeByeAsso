/**
 * privacy module — public API (phase 10): export of the person's own data and account
 * deletion by anonymisation (orchestrates the owner modules' `anonymise*` commands).
 */
export const MODULE_NAME = "privacy" as const;

export * from "./privacy";
