/**
 * volunteers module — public API (phase 5: recruitment and qualification).
 * Other modules must import ONLY from this file.
 */
export const MODULE_NAME = "volunteers" as const;

export * from "./applications";
export * from "./availability";
export * from "./catalogue";
export * from "./emails";
export * from "./schemas";
export * from "./staffing";
export * from "./state-machine";
