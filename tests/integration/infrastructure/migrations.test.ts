import type { DatabaseHandle } from "@kroov/database";
import { runMigrations } from "@kroov/database/migrate";
import { listPublicTables } from "@kroov/database/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectConstraintViolation, freshTestDatabase } from "../helpers/db";

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await freshTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

describe("database migrations (clean database)", () => {
  it("creates the Phase 0 infrastructure tables", async () => {
    const tables = await listPublicTables(handle.db);
    expect(tables).toEqual(
      expect.arrayContaining([
        "idempotency_records",
        "outbox_events",
        "job_executions",
        "feature_flags",
        "drizzle_migrations",
      ]),
    );
  });

  it("is idempotent: running migrations twice applies nothing new", async () => {
    const before = await handle.db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle_migrations`,
    );
    await runMigrations(handle.db);
    const after = await handle.db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle_migrations`,
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("uses UUID primary keys with database-side defaults", async () => {
    const result = await handle.db.execute<{ column_default: string; data_type: string }>(sql`
      select column_default, data_type from information_schema.columns
      where table_name = 'outbox_events' and column_name = 'id'
    `);
    expect(result.rows[0]?.data_type).toBe("uuid");
    expect(result.rows[0]?.column_default).toContain("gen_random_uuid");
  });

  it("enforces the (scope, key) uniqueness of idempotency records", async () => {
    const insert = sql`
      insert into idempotency_records (scope, key, request_hash, expires_at)
      values ('test', 'k1', 'h', now() + interval '1 hour')
    `;
    await handle.db.execute(insert);
    expect(await expectConstraintViolation(handle.db.execute(insert))).toBe("idempotency_records_scope_key_uq");
  });

  it("enforces the feature flag key format check constraint", async () => {
    expect(
      await expectConstraintViolation(handle.db.execute(sql`insert into feature_flags (key) values ('INVALID KEY')`)),
    ).toBe("feature_flags_key_format");
    await handle.db.execute(sql`insert into feature_flags (key, enabled) values ('ticketing.partial_refunds', false)`);
    expect(
      await expectConstraintViolation(
        handle.db.execute(sql`insert into feature_flags (key, enabled) values ('ticketing.partial_refunds', true)`),
      ),
    ).toBe("feature_flags_key_global_uq");
  });
});
