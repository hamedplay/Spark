#!/usr/bin/env bash
set -Eeuo pipefail

SPARK_ROOT="${SPARK_ROOT:-/opt/spark}"
SUPABASE_ROOT="${SUPABASE_ROOT:-/opt/spark-supabase}"
BASE_MIGRATION="${SPARK_ROOT}/supabase/migrations/20260914124000_orphan_auth_user_cleanup_semantics.sql"
GRANT_SCHEMA_FIX="${SPARK_ROOT}/supabase/migrations/20260914131000_fix_orphan_cleanup_stepup_grant_schema.sql"

[[ ${EUID:-$(id -u)} -eq 0 ]] || exec sudo -E "$0" "$@"
[[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
  echo "Spark DB repair: Supabase compose not found at ${SUPABASE_ROOT}." >&2
  exit 1
}
[[ -f "$BASE_MIGRATION" ]] || {
  echo "Spark DB repair: required migration not found: ${BASE_MIGRATION}" >&2
  exit 1
}
[[ -f "$GRANT_SCHEMA_FIX" ]] || {
  echo "Spark DB repair: required migration not found: ${GRANT_SCHEMA_FIX}" >&2
  exit 1
}

compose() {
  (cd "$SUPABASE_ROOT" && docker compose "$@")
}

if ! compose ps --status running --services | grep -Fxq db; then
  echo "Spark DB repair: database container is not running." >&2
  exit 1
fi

list_contract_state() {
  compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT CASE
       WHEN to_regprocedure('public.list_malformed_phone_records()') IS NOT NULL
        AND to_regprocedure('public.clear_malformed_phone_record(uuid)') IS NOT NULL
        AND pg_get_function_result('public.list_malformed_phone_records()'::regprocedure)
              LIKE 'TABLE(auth_user_id uuid, email text, phone text,%'
       THEN 'ready' ELSE 'stale' END;"
}

clear_contract_state() {
  compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT CASE
       WHEN to_regprocedure('private.clear_malformed_phone_record(uuid)') IS NOT NULL
        AND position('revoked_at' in pg_get_functiondef('private.clear_malformed_phone_record(uuid)'::regprocedure)) = 0
        AND position('g.factor_type = ''totp''' in pg_get_functiondef('private.clear_malformed_phone_record(uuid)'::regprocedure)) > 0
        AND position('g.assurance_level = ''aal2''' in pg_get_functiondef('private.clear_malformed_phone_record(uuid)'::regprocedure)) > 0
       THEN 'ready' ELSE 'stale' END;"
}

list_state="$(list_contract_state 2>/dev/null || true)"
if [[ "$list_state" != "ready" ]]; then
  echo "Spark DB repair: applying orphan-auth cleanup RPC migration..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$BASE_MIGRATION"
fi

clear_state="$(clear_contract_state 2>/dev/null || true)"
if [[ "$clear_state" != "ready" ]]; then
  echo "Spark DB repair: aligning cleanup RPC with session_security_grants schema..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$GRANT_SCHEMA_FIX"
else
  echo "Spark DB repair: cleanup RPC grant contract is current."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "NOTIFY pgrst, 'reload schema';" >/dev/null
fi

list_state="$(list_contract_state)"
clear_state="$(clear_contract_state)"
[[ "$list_state" == "ready" && "$clear_state" == "ready" ]] || {
  echo "Spark DB repair: RPC validation failed after migration." >&2
  exit 1
}

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

echo "Spark DB repair: orphan-auth cleanup RPCs are ready."
