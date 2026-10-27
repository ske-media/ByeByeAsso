import { createDatabase, type DatabaseHandle } from "@kroov/database";
import { runMigrations } from "@kroov/database/migrate";
import { resetSchema } from "@kroov/database/testing";

/**
 * Open a handle on the test database, wipe it and migrate from scratch.
 * Every integration test file starts from a clean, fully migrated schema.
 */
export async function freshTestDatabase(): Promise<DatabaseHandle> {
  const connectionString = process.env.DATABASE_URL_TEST;
  if (!connectionString) throw new Error("DATABASE_URL_TEST manquant");
  const handle = createDatabase({ connectionString, poolMax: 4, applicationName: "kroov-test" });
  await resetSchema(handle.db);
  await runMigrations(handle.db);
  return handle;
}

/**
 * Drizzle wraps driver errors ("Failed query: …") and keeps the PostgreSQL error as `cause`.
 * Returns the violated constraint name, or throws if the promise did not reject.
 */
export async function expectConstraintViolation(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string; code?: string } }).cause;
    if (cause?.constraint) return cause.constraint;
    throw new Error(`Rejet sans contrainte identifiée : ${(error as Error).message}`);
  }
  throw new Error("La requête aurait dû être rejetée par une contrainte.");
}
