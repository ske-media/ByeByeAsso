import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration. Migrations are generated as SQL files in ./migrations
 * and applied with the custom runner (src/cli/migrate.ts) — never `drizzle-kit push`
 * in production (no runtime schema synchronisation).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://kroov:kroov@localhost:5432/kroov",
  },
  migrations: {
    table: "drizzle_migrations",
    schema: "public",
  },
});
