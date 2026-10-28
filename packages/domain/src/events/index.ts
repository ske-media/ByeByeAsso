/**
 * events module — public API.
 * Lifecycle through the typed state machine only; every command authorises with
 * `events.*` permissions at organization or event scope and writes its audit entry.
 */
export * from "./events";
export * from "./locations";
export * from "./public";
export * from "./schemas";
export * from "./state-machine";
