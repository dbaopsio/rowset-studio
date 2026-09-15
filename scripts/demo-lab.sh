#!/bin/sh
# Manage the existing local demo lab. Stop retains containers and data.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "${1:-status}" in
  start)
    sh "$root/scripts/mongo-demo.sh" start
    docker start rowset-clickhouse-demo rowset-e2e-pg rowset-e2e-mysql rowset-e2e-mariadb rowset-e2e-mssql
    ;;
  stop)
    docker stop --time 30 rowset-mongo-demo rowset-clickhouse-demo rowset-e2e-pg rowset-e2e-mysql rowset-e2e-mariadb rowset-e2e-mssql
    ;;
  status)
    docker stats --no-stream rowset-mongo-demo rowset-clickhouse-demo rowset-e2e-pg rowset-e2e-mysql rowset-e2e-mariadb rowset-e2e-mssql
    ;;
  seed)
    PYTHONDONTWRITEBYTECODE=1 python3 "$root/scripts/demo/seed.py"
    PYTHONDONTWRITEBYTECODE=1 python3 "$root/scripts/demo/connect.py"
    ;;
  *) printf 'Usage: %s [start|stop|status|seed]\n' "$0" >&2; exit 1 ;;
esac
