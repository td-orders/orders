#!/bin/sh
# Collaudo locale: database pulito, server di test sulla porta 3100, suite end-to-end.
# Richiede PostgreSQL raggiungibile (default postgres://postgres@localhost:5432).
export DATABASE_URL=${DATABASE_URL:-postgres://postgres@localhost:5432/orders_test}
psql "${DATABASE_URL%/*}/postgres" -qc "DROP DATABASE IF EXISTS orders_test" -qc "CREATE DATABASE orders_test" || exit 1
SEED_SUPERADMIN_EMAIL=francesco.epifani@toscanadiagnostica.it SEED_SUPERADMIN_PASSWORD=Prova-Sicura-2026 DISABLE_SCHEDULER=true SILVA_MODE=SIMULATO PORT=3100 node src/index.js > /tmp/td-orders-test.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT INT TERM
for i in $(seq 1 30); do curl -sf localhost:3100/api/health >/dev/null && break; sleep 1; done
BASE=http://localhost:3100 node --test test/e2e.test.js
RC=$?
kill $PID 2>/dev/null; wait $PID 2>/dev/null
exit $RC
