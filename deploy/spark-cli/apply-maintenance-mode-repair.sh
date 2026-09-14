#!/usr/bin/env bash
set -Eeuo pipefail

SPARK_ROOT="${SPARK_ROOT:-/opt/spark}"
SUPABASE_ROOT="${SUPABASE_ROOT:-/opt/spark-supabase}"
DB_REPAIR_ROOT="${SPARK_ROOT}/deploy/spark-cli/db-repairs"
CONTROL_RPC="${DB_REPAIR_ROOT}/20260914142000_maintenance_mode_control_rpc.sql"
RUNTIME_VISIBILITY="${DB_REPAIR_ROOT}/20260914142500_maintenance_mode_runtime_visibility.sql"

[[ ${EUID:-$(id -u)} -eq 0 ]] || exec sudo -E "$0" "$@"
[[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
  echo "Spark maintenance repair: Supabase compose not found at ${SUPABASE_ROOT}." >&2
  exit 1
}

compose() {
  (cd "$SUPABASE_ROOT" && docker compose "$@")
}

if ! compose ps --status running --services | grep -Fxq db; then
  echo "Spark maintenance repair: database container is not running." >&2
  exit 1
fi

contract_state() {
  compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT CASE
       WHEN to_regprocedure('public.set_maintenance_mode(boolean)') IS NOT NULL
        AND has_function_privilege('authenticated', 'public.set_maintenance_mode(boolean)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.set_maintenance_mode(boolean)', 'EXECUTE')
        AND EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'system_config'
            AND policyname = 'system_config_authenticated_read_maintenance_mode'
            AND cmd = 'SELECT'
        )
       THEN 'ready' ELSE 'stale' END;"
}

state="$(contract_state 2>/dev/null || true)"
if [[ "$state" != "ready" ]]; then
  [[ -f "$CONTROL_RPC" ]] || {
    echo "Spark maintenance repair: missing repair asset: ${CONTROL_RPC}" >&2
    exit 1
  }
  [[ -f "$RUNTIME_VISIBILITY" ]] || {
    echo "Spark maintenance repair: missing repair asset: ${RUNTIME_VISIBILITY}" >&2
    exit 1
  }

  echo "Spark maintenance repair: applying maintenance-mode control RPC..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$CONTROL_RPC"
  echo "Spark maintenance repair: exposing maintenance flag to authenticated runtime..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$RUNTIME_VISIBILITY"
else
  echo "Spark maintenance repair: maintenance-mode contract is current."
fi

compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "NOTIFY pgrst, 'reload schema';" >/dev/null

state="$(contract_state)"
[[ "$state" == "ready" ]] || {
  echo "Spark maintenance repair: validation failed after repair." >&2
  exit 1
}

echo "Spark maintenance repair: maintenance-mode control is ready."
