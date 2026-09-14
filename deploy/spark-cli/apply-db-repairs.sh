#!/usr/bin/env bash
set -Eeuo pipefail

SPARK_ROOT="${SPARK_ROOT:-/opt/spark}"
SUPABASE_ROOT="${SUPABASE_ROOT:-/opt/spark-supabase}"
MIGRATION="${SPARK_ROOT}/supabase/migrations/20260914120500_restore_malformed_phone_cleanup_rpc.sql"

[[ ${EUID:-$(id -u)} -eq 0 ]] || exec sudo -E "$0" "$@"
[[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
  echo "Spark DB repair: Supabase compose not found at ${SUPABASE_ROOT}." >&2
  exit 1
}
[[ -f "$MIGRATION" ]] || {
  echo "Spark DB repair: required migration not found: ${MIGRATION}" >&2
  exit 1
}

compose() {
  (cd "$SUPABASE_ROOT" && docker compose "$@")
}

if ! compose ps --status running --services | grep -Fxq db; then
  echo "Spark DB repair: database container is not running." >&2
  exit 1
fi

rpc_state() {
  compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT CASE
       WHEN to_regprocedure('public.list_malformed_phone_records()') IS NOT NULL
        AND to_regprocedure('public.clear_malformed_phone_record(uuid)') IS NOT NULL
       THEN 'ready' ELSE 'missing' END;"
}

state="$(rpc_state 2>/dev/null || true)"
if [[ "$state" != "ready" ]]; then
  echo "Spark DB repair: restoring malformed-phone cleanup RPCs..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$MIGRATION"
else
  echo "Spark DB repair: malformed-phone cleanup RPCs already exist."
  # A previous DB restore can leave PostgREST with a stale schema cache even
  # when the functions are present. Refresh it on every reconciliation.
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "NOTIFY pgrst, 'reload schema';" >/dev/null
fi

state="$(rpc_state)"
[[ "$state" == "ready" ]] || {
  echo "Spark DB repair: RPC validation failed after migration." >&2
  exit 1
}

# Validate the exact PostgREST-facing signatures and keep anonymous callers out.
validation="$(compose exec -T db psql -X -U postgres -d postgres -Atqc \
  "SELECT count(*)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND ((p.proname = 'list_malformed_phone_records' AND pg_get_function_identity_arguments(p.oid) = '')
        OR (p.proname = 'clear_malformed_phone_record' AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid'))
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');")"
[[ "$validation" == "2" ]] || {
  echo "Spark DB repair: RPC privilege/signature validation failed (matched=${validation:-0})." >&2
  exit 1
}

echo "Spark DB repair: malformed-phone cleanup RPCs are ready."
