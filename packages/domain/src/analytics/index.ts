/**
 * analytics module — public API (phase 9: organization / event dashboards and finance overview,
 * computed from the authoritative records — ledger, orders, tickets, refunds, memberships,
 * volunteers, published schedule, campaigns). No stored aggregates, no fixtures.
 */
export const MODULE_NAME = "analytics" as const;

export * from "./dashboards";
