#!/usr/bin/env bash
set -euo pipefail

load_env_file() {
  local env_file="$1"
  local override_existing="${2:-false}"
  if [ ! -f "$env_file" ]; then
    return 0
  fi

  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    local line key value quote
    line="$(printf '%s' "$raw_line" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    if [ -z "$line" ] || [[ "$line" == \#* ]]; then
      continue
    fi
    if [[ "$line" == export[[:space:]]* ]]; then
      line="$(printf '%s' "${line#export }" | sed -E 's/^[[:space:]]+//')"
    fi
    if [[ "$line" != *=* ]]; then
      continue
    fi

    key="$(printf '%s' "${line%%=*}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    value="$(printf '%s' "${line#*=}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi
    if [ "$override_existing" != "true" ] && [ -n "${!key+x}" ]; then
      continue
    fi

    quote="${value:0:1}"
    if { [ "$quote" = '"' ] || [ "$quote" = "'" ]; } && [ "${value: -1}" = "$quote" ]; then
      value="${value:1:${#value}-2}"
    else
      value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//')"
    fi
    export "$key=$value"
  done < "$env_file"
}

if [ -n "${PROBX_ENV_FILE:-}" ]; then
  load_env_file "$PROBX_ENV_FILE" true
fi

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
