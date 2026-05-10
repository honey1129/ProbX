#!/usr/bin/env bash
set -euo pipefail

DSN="${PROBX_MYSQL_CLI_DSN:-${PROBX_DATABASE_DSN:-probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true}}"

if [[ "$DSN" == mysql://* ]]; then
  without_scheme="${DSN#mysql://}"
  credentials="${without_scheme%@*}"
  location_db="${without_scheme#*@}"
  host_port="${location_db%%/*}"
  database="${location_db#*/}"
elif [[ "$DSN" == *@tcp\(*\)/* ]]; then
  dsn_without_params="${DSN%%\?*}"
  credentials="${dsn_without_params%@tcp(*}"
  location_db="${dsn_without_params#*@tcp(}"
  host_port="${location_db%%)*}"
  database="${location_db#*)/}"
else
  echo "PROBX_DATABASE_DSN must use user:pass@tcp(host:port)/db or PROBX_MYSQL_CLI_DSN must use mysql://user:pass@host:port/db" >&2
  exit 1
fi

user="${credentials%%:*}"
password="${credentials#*:}"
host="${host_port%%:*}"
port="${host_port#*:}"
database="${database%%\?*}"

if [ "$host" = "$host_port" ]; then
  port="3306"
fi

if [ -z "$user" ] || [ -z "$password" ] || [ -z "$host" ] || [ -z "$port" ] || [ -z "$database" ]; then
  echo "Could not parse MySQL connection information from DSN" >&2
  exit 1
fi

for migration in "$(dirname "$0")"/../migrations/*.sql; do
  echo "Applying ${migration}"
  mysql -h "$host" -P "$port" -u "$user" "-p$password" "$database" < "$migration"
done
