#!/usr/bin/env bash
set -euo pipefail

DSN="${PROBX_MYSQL_CLI_DSN:-mysql://probx:probx@127.0.0.1:3306/probx}"

if [[ "$DSN" != mysql://* ]]; then
  echo "PROBX_MYSQL_CLI_DSN must use mysql://user:pass@host:port/db" >&2
  exit 1
fi

without_scheme="${DSN#mysql://}"
credentials="${without_scheme%@*}"
location_db="${without_scheme#*@}"
user="${credentials%%:*}"
password="${credentials#*:}"
host_port="${location_db%%/*}"
database="${location_db#*/}"
host="${host_port%%:*}"
port="${host_port#*:}"

for migration in "$(dirname "$0")"/../migrations/*.sql; do
  echo "Applying ${migration}"
  mysql -h "$host" -P "$port" -u "$user" "-p$password" "$database" < "$migration"
done
