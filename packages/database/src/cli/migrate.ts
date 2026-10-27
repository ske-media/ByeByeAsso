import "dotenv/config";
import { createDatabase } from "../client";
import { runMigrations } from "../migrate";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL est requis pour appliquer les migrations.");
  process.exit(1);
}

const handle = createDatabase({ connectionString, poolMax: 1, applicationName: "kroov-migrate" });
try {
  await runMigrations(handle.db);
  console.log("Migrations appliquées.");
} catch (error) {
  console.error("Échec des migrations :", error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
