#!/usr/bin/env node
/**
 * Produce one plain-SQL file per Drizzle migration, ready to apply through the Supabase
 * dashboard / MCP (no `--> statement-breakpoint` markers), followed by the exact bookkeeping row
 * `drizzle-orm` would write — so a later `pnpm db:migrate` against the same database sees them as
 * applied and only runs newer migrations.
 *
 * Usage: node scripts/supabase-bundle.mjs [outDir]   (default .tmp/supabase)
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrations = resolve(root, "packages/database/migrations");
const outDir = resolve(process.argv[2] ?? ".tmp/supabase");
mkdirSync(outDir, { recursive: true });

const journal = JSON.parse(readFileSync(resolve(migrations, "meta/_journal.json"), "utf8"));
const bookkeeping = `CREATE TABLE IF NOT EXISTS "public"."drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);`;

for (const entry of journal.entries) {
  const file = resolve(migrations, `${entry.tag}.sql`);
  const raw = readFileSync(file, "utf8");
  // Same hash as drizzle-orm's migrator (sha256 of the raw file content).
  const hash = createHash("sha256").update(raw).digest("hex");
  const sql = raw.replaceAll("--> statement-breakpoint", "");
  const body = `-- ${entry.tag} (journal when=${entry.when})\n${bookkeeping}\n\n${sql.trim()}\n\nINSERT INTO "public"."drizzle_migrations" (hash, created_at)\nSELECT '${hash}', ${entry.when}\nWHERE NOT EXISTS (SELECT 1 FROM "public"."drizzle_migrations" WHERE hash = '${hash}');\n`;
  writeFileSync(resolve(outDir, `${entry.tag}.sql`), body);
  console.log(`${entry.tag}.sql  ${sql.length} chars  hash ${hash.slice(0, 12)}…`);
}
