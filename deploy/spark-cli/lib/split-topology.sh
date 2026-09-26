#!/usr/bin/env bash
# Role-aware helpers for the approved split Spark topology.
# This module is intentionally side-effect free when sourced.

spark_topology_load() {
  SPARK_NODE_ROLE="${SPARK_NODE_ROLE:-single}"
  SPARK_DB_HOST="${SPARK_DB_HOST:-127.0.0.1}"
  SPARK_DB_PORT="${SPARK_DB_PORT:-5432}"
  SPARK_APP_HOST="${SPARK_APP_HOST:-127.0.0.1}"

  if [[ -r "${MANAGER_CONF:-/etc/spark/manager.conf}" ]]; then
    # shellcheck disable=SC1090
    source "${MANAGER_CONF:-/etc/spark/manager.conf}"
  fi

  case "$SPARK_NODE_ROLE" in
    single|application|database) ;;
    *)
      printf 'Invalid SPARK_NODE_ROLE=%s (expected single, application, or database)\n' "$SPARK_NODE_ROLE" >&2
      return 1
      ;;
  esac
}

spark_topology_is_single() { [[ "$SPARK_NODE_ROLE" == "single" ]]; }
spark_topology_is_application() { [[ "$SPARK_NODE_ROLE" == "application" ]]; }
spark_topology_is_database() { [[ "$SPARK_NODE_ROLE" == "database" ]]; }

spark_topology_validate_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local IFS=. octet
  for octet in $ip; do
    (( octet >= 0 && octet <= 255 )) || return 1
  done
}

spark_topology_validate() {
  spark_topology_load || return 1
  case "$SPARK_NODE_ROLE" in
    single) return 0 ;;
    application|database)
      spark_topology_validate_ipv4 "$SPARK_DB_HOST" || {
        printf 'Invalid SPARK_DB_HOST=%s\n' "$SPARK_DB_HOST" >&2
        return 1
      }
      [[ "$SPARK_DB_PORT" =~ ^[0-9]+$ ]] && (( SPARK_DB_PORT >= 1 && SPARK_DB_PORT <= 65535 )) || {
        printf 'Invalid SPARK_DB_PORT=%s\n' "$SPARK_DB_PORT" >&2
        return 1
      }
      ;;
  esac
}

spark_topology_write_config() {
  local role="$1" db_host="$2" db_port="${3:-5432}" app_host="${4:-}"
  case "$role" in single|application|database) ;; *) return 2 ;; esac
  spark_topology_validate_ipv4 "$db_host" || return 2
  [[ "$db_port" =~ ^[0-9]+$ ]] && (( db_port >= 1 && db_port <= 65535 )) || return 2
  install -d -m 0700 "${CONFIG_DIR:-/etc/spark}"
  local file="${MANAGER_CONF:-/etc/spark/manager.conf}" tmp
  tmp="$(mktemp)"
  if [[ -f "$file" ]]; then
    grep -Ev '^(SPARK_NODE_ROLE|SPARK_DB_HOST|SPARK_DB_PORT|SPARK_APP_HOST)=' "$file" >"$tmp" || true
  fi
  {
    cat "$tmp"
    printf 'SPARK_NODE_ROLE=%q\n' "$role"
    printf 'SPARK_DB_HOST=%q\n' "$db_host"
    printf 'SPARK_DB_PORT=%q\n' "$db_port"
    [[ -n "$app_host" ]] && printf 'SPARK_APP_HOST=%q\n' "$app_host"
  } >"${tmp}.new"
  install -m 0600 "${tmp}.new" "$file"
  rm -f "$tmp" "${tmp}.new"
}

spark_topology_status() {
  spark_topology_load || return 1
  printf 'SPARK_NODE_ROLE=%s\n' "$SPARK_NODE_ROLE"
  printf 'SPARK_DB_HOST=%s\n' "$SPARK_DB_HOST"
  printf 'SPARK_DB_PORT=%s\n' "$SPARK_DB_PORT"
  printf 'SPARK_APP_HOST=%s\n' "$SPARK_APP_HOST"
}
