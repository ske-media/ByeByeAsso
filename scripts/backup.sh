#!/usr/bin/env bash
# Logical backup of the Kroov database (pg_dump, custom format, compressed).
# Usage: scripts/backup.sh [output-dir]   — reads DATABASE_URL (or the repo-root .env).
# Output: <dir>/kroov-<UTC timestamp>.dump + .sha256. Restore with scripts/restore.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"')"
fi
: "${DATABASE_URL:?DATABASE_URL est requis}"
OUT_DIR="${1:-$ROOT/backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/kroov-$STAMP.dump"
# --no-owner/--no-privileges: restorable under any role; pgboss schema excluded (transient jobs).
pg_dump "$DATABASE_URL" --format=custom --compress=6 --no-owner --no-privileges --exclude-schema=pgboss --file="$FILE"
(cd "$OUT_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256")
SIZE="$(du -h "$FILE" | cut -f1)"
echo "backup: $FILE ($SIZE)"
echo "sha256: $(cut -d' ' -f1 "$FILE.sha256")"
