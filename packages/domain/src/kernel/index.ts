/**
 * Shared kernel: primitives every domain module may depend on.
 * Nothing in here knows about a specific module.
 */

export * from "./actor";
export * from "./errors";
export * from "./ids";
export * from "./money";
export * from "./result";
export * from "./state-machine";
export * from "./time";
