import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either a database handle or a transaction: services accept both so they compose. */
export type DbExecutor = Database | Transaction;

export interface CreateDatabaseOptions {
  connectionString: string;
  poolMax?: number;
  /** Application name reported to PostgreSQL (visible in pg_stat_activity). */
  applicationName?: string;
}

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/**
 * Create a pooled Drizzle client. Callers own the lifecycle (close on shutdown).
 * Timestamps are returned as JS Dates in UTC; the app renders Europe/Paris explicitly.
 */
export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.poolMax ?? 10,
    application_name: options.applicationName ?? "kroov",
    // Fail fast rather than hanging a request on a dead database.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  const db = drizzle({ client: pool, schema, casing: "snake_case" });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

/** Lightweight connectivity probe used by health checks. Never throws. */
export async function pingDatabase(
  db: Database,
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const started = performance.now();
  try {
    await db.execute("select 1");
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}
