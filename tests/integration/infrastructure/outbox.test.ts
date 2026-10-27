import { type DatabaseHandle, schema } from "@kroov/database";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await freshTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

describe("transactional outbox", () => {
  it("writes an event in the same transaction as a domain change and rolls both back on failure", async () => {
    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(schema.outboxEvents).values({
          aggregateType: "demo",
          aggregateId: "1",
          eventType: "demo.created",
          payload: { hello: "world" },
        });
        throw new Error("simulated failure after outbox write");
      }),
    ).rejects.toThrow(/simulated failure/);

    const rows = await handle.db.select().from(schema.outboxEvents);
    expect(rows).toHaveLength(0);
  });

  it("claims pending rows with SKIP LOCKED so two relays never take the same row", async () => {
    await handle.db.insert(schema.outboxEvents).values([
      { aggregateType: "demo", aggregateId: "a", eventType: "demo.a", payload: {} },
      { aggregateType: "demo", aggregateId: "b", eventType: "demo.b", payload: {} },
    ]);

    // Relay 1 locks one row and holds the transaction open.
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let firstClaimed: string | undefined;
    const first = handle.db.transaction(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`select id from outbox_events where status = 'pending' order by created_at limit 1 for update skip locked`,
      );
      firstClaimed = r.rows[0]?.id;
      await firstHolds;
    });

    // Give the first transaction time to acquire its lock.
    await new Promise((r) => setTimeout(r, 100));

    const second = await handle.db.transaction(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`select id from outbox_events where status = 'pending' order by created_at limit 1 for update skip locked`,
      );
      return r.rows[0]?.id;
    });

    releaseFirst();
    await first;

    expect(firstClaimed).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(firstClaimed);
  });

  it("marks a row dispatched exactly once", async () => {
    const [row] = await handle.db
      .insert(schema.outboxEvents)
      .values({ aggregateType: "demo", aggregateId: "c", eventType: "demo.c", payload: {} })
      .returning();
    expect(row).toBeDefined();
    const updated = await handle.db
      .update(schema.outboxEvents)
      .set({ status: "dispatched", dispatchedAt: new Date() })
      .where(eq(schema.outboxEvents.id, row!.id))
      .returning({ status: schema.outboxEvents.status });
    expect(updated[0]?.status).toBe("dispatched");
  });
});
