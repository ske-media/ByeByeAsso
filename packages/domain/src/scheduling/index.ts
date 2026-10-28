/**
 * scheduling module — public API (phase 6: constraint-based planning, versions, publication).
 * Other modules must import ONLY from this file.
 */
export const MODULE_NAME = "scheduling" as const;

export * from "./emails";
export * from "./engine";
export * from "./scheduling";
export * from "./schemas";
export * from "./state-machine";
