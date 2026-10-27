import "dotenv/config";
import { createDatabase } from "../client";
import { runMigrations } from "../migrate";
import { resetSchema } from "../testing";

/**
 * DEVELOPMENT ONLY: drop and recreate the public schema, then migrate from scratch.
 * Refuses to run when NODE_ENV=production or when the URL does not look local.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL est requis.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Refus : reset interdit en production.");
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1|postgres:\/\/[^@]+@(db|postgres)[:/]/.test(connectionString)) {
  console.error("Refus : DATABASE_URL ne semble pas désigner une base locale.");
  process.exit(1);
}

const handle = createDatabase({ connectionString, poolMax: 1, applicationName: "kroov-reset" });
try {
  await resetSchema(handle.db);
  await runMigrations(handle.db);
  console.log("Base réinitialisée et migrée.");
} finally {
  await handle.close();
}
