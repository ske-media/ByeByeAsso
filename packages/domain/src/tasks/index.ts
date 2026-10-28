/**
 * tasks module — public API (phase 9): organization tasks (manual and system-created,
 * idempotent by source key), assignee = active member of the organization, optimistic
 * version token, CSV export. Reads need organization.read, writes tasks.manage.
 */
export const MODULE_NAME = "tasks" as const;

export * from "./schemas";
export * from "./tasks";
