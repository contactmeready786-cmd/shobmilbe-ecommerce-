#!/usr/bin/env bash
# Builds the template database "shop_tpl": the shop's own schema (made by the app on first start),
# the test products/orders from seed.sql and one owner account. Every parity crawl starts from a copy.
#   tools/parity/make-template.sh <port> <start command...>
set -euo pipefail
PORT=$1; shift
export PGHOST=${PGHOST:-/tmp} PGUSER=${PGUSER:-postgres}
dropdb --if-exists --force shop_tpl >/dev/null
createdb shop_tpl
export DATABASE_URL="postgres://$PGUSER:${PGPASSWORD:-}@127.0.0.1:${PGPORT:-5432}/shop_tpl?sslmode=disable" PORT
setsid "$@" >/dev/null 2>&1 &
PID=$!
for _ in $(seq 1 120); do curl -s -o /dev/null "http://127.0.0.1:$PORT/robots.txt" && break; sleep 0.5; done
psql -q -v ON_ERROR_STOP=1 -d shop_tpl -f "$(dirname "$0")/seed.sql"
curl -s -o /dev/null -X POST "http://127.0.0.1:$PORT/admin/setup" -H "Origin: http://127.0.0.1:$PORT" \
  --data-urlencode name='Test Owner' --data-urlencode username=owner \
  --data-urlencode 'password=Parity-Test-9271!' --data-urlencode 'password2=Parity-Test-9271!'
kill -- -$PID; wait $PID 2>/dev/null || true
# no open connections may remain on a template
psql -q -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='shop_tpl'" >/dev/null
echo "template ready"
