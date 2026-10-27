import { sql } from "drizzle-orm";
import type { Database } from "./client";

/**
 * Test helpers. Only ever pointed at DATABASE_URL_TEST — never at a production database.
 */

/** Drop and recreate the public schema (drops every table, type and migration record). */
export async function resetSchema(db: Database): Promise<void> {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema if exists pgboss cascade`);
  await db.execute(sql`create schema public`);
}

/** List user tables in the public schema — used by migration smoke tests. */
export async function listPublicTables(db: Database): Promise<string[]> {
  const result = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  return result.rows.map((r) => r.table_name);
}

/** Truncate the given tables (restart identity, cascade). Fast per-test cleanup. */
export async function truncateTables(db: Database, tables: readonly string[]): Promise<void> {
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.replaceAll('"', '""')}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${list} restart identity cascade`));
}
