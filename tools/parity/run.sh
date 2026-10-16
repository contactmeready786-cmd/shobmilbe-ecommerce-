#!/usr/bin/env bash
# Crawls one version of the site from an identical starting database, so two runs can be compared.
#   tools/parity/run.sh <out-dir> <port> <start command...>
# Needs a local Postgres (PGHOST/PGUSER) with a template database "shop_tpl" made by make-template.sh.
set -euo pipefail
OUT=$1; PORT=$2; shift 2
DB=shop_parity_$PORT
export PGHOST=${PGHOST:-/tmp} PGUSER=${PGUSER:-postgres}
dropdb --if-exists "$DB" >/dev/null
createdb -T shop_tpl "$DB"
export DATABASE_URL="postgres://$PGUSER:${PGPASSWORD:-}@127.0.0.1:${PGPORT:-5432}/$DB?sslmode=disable" PORT
"$@" >"$OUT.server.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do curl -s -o /dev/null "http://127.0.0.1:$PORT/robots.txt" && break; sleep 0.5; done
rm -rf "$OUT"
if [ "${SCENARIOS:-}" = 1 ]; then
  PGDATABASE="$DB" node "$(dirname "$0")/scenarios.mjs" "http://127.0.0.1:$PORT" "$OUT.json"
else
  node "$(dirname "$0")/crawl.mjs" "http://127.0.0.1:$PORT" "$OUT" --login 'owner:Parity-Test-9271!'
fi
