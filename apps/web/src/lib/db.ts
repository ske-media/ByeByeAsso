import "server-only";
import { createDatabase, type Database, type DatabaseHandle } from "@kroov/database";
import { env } from "./env";

/**
 * One pool per Node process. In development Next.js reloads modules, so the handle is
 * cached on globalThis to avoid leaking connections on every hot reload.
 */
const globalForDb = globalThis as unknown as { __kroovDb?: DatabaseHandle };

export function db(): Database {
  if (!globalForDb.__kroovDb) {
    const e = env();
    globalForDb.__kroovDb = createDatabase({
      connectionString: e.DATABASE_URL,
      poolMax: e.DATABASE_POOL_MAX,
      applicationName: "kroov-web",
    });
  }
  return globalForDb.__kroovDb.db;
}
