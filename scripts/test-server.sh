#!/usr/bin/env bash
# Start/stop the production build on :3000 with the test mailbox (used by security + e2e suites).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTBOX="${EMAIL_FILE_PATH:-$ROOT/.tmp/outbox.jsonl}"
case "${1:-}" in
  stop)
    pkill -f "next-server \(v" || true
    sleep 1
    ;;
  start)
    "$0" stop
    mkdir -p "$(dirname "$OUTBOX")"; : > "$OUTBOX"
    cd "$ROOT/apps/web"
    APP_ENV=test EMAIL_PROVIDER=file EMAIL_FILE_PATH="$OUTBOX" setsid nohup npx next start --port 3000 > "$ROOT/.tmp/web-start.log" 2>&1 &
    for _ in $(seq 1 30); do
      if curl -fs -o /dev/null http://localhost:3000/connexion; then echo "server up"; exit 0; fi
      sleep 1
    done
    echo "server did not start"; tail -20 "$ROOT/.tmp/web-start.log"; exit 1
    ;;
  *) echo "usage: $0 start|stop"; exit 2 ;;
esac
