import type { Database } from "@kroov/database";
import { describe, expect, it } from "vitest";
import { EVENT_ROUTING, HANDLED_EVENT_TYPES, handleDomainEvent } from "./handlers";
import { NOTIFICATION_KINDS } from "./notifications";

describe("notifications · domain-event routing", () => {
  it("has one handler per notification kind, each routed to a permission", () => {
    expect([...HANDLED_EVENT_TYPES].sort()).toEqual([...NOTIFICATION_KINDS].sort());
    for (const kind of NOTIFICATION_KINDS) expect(EVENT_ROUTING[kind].permission).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(EVENT_ROUTING["schedule.unavailability_reported"].systemTask).toBe(true);
    expect(EVENT_ROUTING["event.published"].excludesActor).toBe(true);
  });

  it("acknowledges unknown event types and events without an organization without touching the database", async () => {
    const db = {
      transaction: () => {
        throw new Error("must not be called");
      },
    } as unknown as Database;
    const base = { outboxId: "x", aggregateType: "demo", aggregateId: "1", payload: null };
    await expect(handleDomainEvent(db, { ...base, eventType: "demo.unknown", organizationId: "org" })).resolves.toEqual(
      {
        handled: false,
        notified: 0,
        tasksCreated: 0,
      },
    );
    await expect(
      handleDomainEvent(db, { ...base, eventType: "event.published", organizationId: null }),
    ).resolves.toEqual({ handled: false, notified: 0, tasksCreated: 0 });
  });
});
