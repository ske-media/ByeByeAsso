import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Apply pending SQL migrations from ./migrations in order, inside Drizzle's migration
 * bookkeeping table (`drizzle_migrations`). Idempotent: already-applied migrations are skipped.
 */
export async function runMigrations(db: Database): Promise<void> {
  // Bookkeeping table lives in `public` (matches drizzle.config.ts) so a schema reset wipes it too.
  await migrate(db, { migrationsFolder, migrationsTable: "drizzle_migrations", migrationsSchema: "public" });
}

export { migrationsFolder };
