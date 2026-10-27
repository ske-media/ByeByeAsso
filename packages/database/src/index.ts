/**
 * Runtime entry: client + schema. The migration runner is deliberately NOT re-exported
 * here (import "@kroov/database/migrate" explicitly) so web bundles never pull the
 * filesystem-based migrator.
 */
export * from "./client";
export * as schema from "./schema/index";
