#!/usr/bin/env bash
# Restore a scripts/backup.sh dump into a database, then verify.
# Usage: scripts/restore.sh <dump-file> <target DATABASE_URL>
# The target database must exist and be EMPTY (or be a scratch database): this script never drops anything.
# After the restore, run `DATABASE_URL=<target> pnpm db:migrate` — it must apply nothing new.
set -euo pipefail
DUMP="${1:?chemin du dump requis}"
TARGET="${2:?DATABASE_URL cible requise}"
if [[ -f "$DUMP.sha256" ]]; then
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256")
fi
TABLES="$(psql "$TARGET" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [[ "$TABLES" != "0" ]]; then
  echo "refus : la base cible contient déjà $TABLES table(s) (restaurez dans une base vide)." >&2
  exit 2
fi
pg_restore --dbname="$TARGET" --no-owner --no-privileges --exit-on-error "$DUMP"
echo "restauré dans $TARGET :"
psql "$TARGET" -Atc "select 'relations publiques: ' || count(*) from information_schema.tables where table_schema='public'"
psql "$TARGET" -Atc "select 'migrations: ' || count(*) from drizzle_migrations"
psql "$TARGET" -Atc "select 'organisations: ' || count(*) from organizations"
psql "$TARGET" -Atc "select 'commandes: ' || count(*) from orders"
