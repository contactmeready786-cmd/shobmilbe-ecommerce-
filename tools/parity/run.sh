#!/usr/bin/env bash
# Crawls one version of the site from an identical starting database, so two runs can be compared.
#   tools/parity/run.sh <out-dir> <port> <start command...>
# Needs a local Postgres (PGHOST/PGUSER) with a template database "shop_tpl" made by make-template.sh.
set -euo pipefail
OUT=$1; PORT=$2; shift 2
DB=shop_parity_$PORT
export PGHOST=${PGHOST:-/tmp} PGUSER=${PGUSER:-postgres}
dropdb --if-exists --force "$DB" >/dev/null
createdb -T shop_tpl "$DB"
export DATABASE_URL="postgres://$PGUSER:${PGPASSWORD:-}@127.0.0.1:${PGPORT:-5432}/$DB?sslmode=disable" PORT
# own process group, so servers started through npx (which runs a child process) are stopped too
setsid "$@" >"$OUT.server.log" 2>&1 &
PID=$!
trap 'kill -- -$PID 2>/dev/null || true; wait $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do curl -s -o /dev/null "http://127.0.0.1:$PORT/robots.txt" && break; sleep 0.5; done
rm -rf "$OUT"
# the crawl / actions / browser tools are TypeScript, run by tsx with the new site's own tsconfig (also when the
# old site is the one being crawled, so "@/…" always means the tools' own code)
HERE=$(cd "$(dirname "$0")" && pwd)
TSX=(npx --yes tsx --tsconfig "$HERE/../../tsconfig.json")
if [ "${BROWSER:-}" = 1 ]; then
  "${TSX[@]}" "$HERE/browser.mts" "http://127.0.0.1:$PORT" "$OUT.json"
elif [ "${SCENARIOS:-}" = 1 ]; then
  PGDATABASE="$DB" "${TSX[@]}" "$HERE/scenarios.mts" "http://127.0.0.1:$PORT" "$OUT.json"
else
  "${TSX[@]}" "$HERE/crawl.mts" "http://127.0.0.1:$PORT" "$OUT" --login 'owner:Parity-Test-9271!'
fi
