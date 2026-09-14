#!/usr/bin/env bash
set -Eeuo pipefail

SPARK_ROOT="${SPARK_ROOT:-/opt/spark}"
SUPABASE_ROOT="${SUPABASE_ROOT:-/opt/spark-supabase}"
PREP_SQL="${SPARK_ROOT}/supabase/migrations/20260914184400_normalize_admin_lifecycle_signature.sql"
REPAIR_SQL="${SPARK_ROOT}/supabase/migrations/20260914184500_align_registration_security_controls.sql"
HARDEN_SQL="${SPARK_ROOT}/supabase/migrations/20260914190000_harden_registration_lifecycle_rpc.sql"

[[ ${EUID:-$(id -u)} -eq 0 ]] || exec sudo -E "$0" "$@"
[[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
  echo "Spark registration repair: Supabase compose not found at ${SUPABASE_ROOT}." >&2
  exit 1
}

compose() {
  (cd "$SUPABASE_ROOT" && docker compose "$@")
}

if ! compose ps --status running --services | grep -Fxq db; then
  echo "Spark registration repair: database container is not running." >&2
  exit 1
fi

contract_state() {
  compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT CASE
       WHEN to_regprocedure('public.get_my_profile_completion_state()') IS NOT NULL
        AND to_regprocedure('public.save_my_profile_completion(jsonb,bigint,boolean)') IS NOT NULL
        AND to_regprocedure('private.evaluate_current_auth_access()') IS NOT NULL
        AND to_regprocedure('private.admin_set_user_lifecycle_service(uuid,uuid,uuid,text,bigint,text)') IS NOT NULL
        AND position('PROFILE_COMPLETION_NOT_REQUIRED' in pg_get_functiondef('private.get_my_profile_completion_state()'::regprocedure)) > 0
        AND position('IN_PROGRESS' in pg_get_functiondef('private.evaluate_current_auth_access()'::regprocedure)) > 0
        AND position('APPROVE_REGISTRATION' in pg_get_functiondef('private.admin_set_user_lifecycle_service(uuid,uuid,uuid,text,bigint,text)'::regprocedure)) > 0
        AND position('REJECT_REGISTRATION' in pg_get_functiondef('private.admin_set_user_lifecycle_service(uuid,uuid,uuid,text,bigint,text)'::regprocedure)) > 0
        AND position('app.profile_completion_write' in pg_get_functiondef('public.guard_protected_profile_fields()'::regprocedure)) > 0
        AND position('app.account_lifecycle_write' in pg_get_functiondef('public.guard_protected_profile_fields()'::regprocedure)) > 0
        AND has_function_privilege('authenticated', 'public.get_my_profile_completion_state()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.save_my_profile_completion(jsonb,bigint,boolean)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.get_my_profile_completion_state()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.save_my_profile_completion(jsonb,bigint,boolean)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.admin_set_user_lifecycle_service(uuid,uuid,uuid,text,bigint,text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.admin_set_user_lifecycle_service(uuid,uuid,uuid,text,bigint,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.admin_set_user_lifecycle_service(uuid,uuid,uuid,text,bigint,text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'private.admin_set_user_lifecycle_service(uuid,uuid,uuid,text,bigint,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'private.admin_set_user_lifecycle_service(uuid,uuid,uuid,text,bigint,text)', 'EXECUTE')
       THEN 'ready' ELSE 'stale' END;"
}

state="$(contract_state 2>/dev/null || true)"
if [[ "$state" != "ready" ]]; then
  [[ -f "$PREP_SQL" ]] || { echo "Spark registration repair: missing ${PREP_SQL}" >&2; exit 1; }
  [[ -f "$REPAIR_SQL" ]] || { echo "Spark registration repair: missing ${REPAIR_SQL}" >&2; exit 1; }
  [[ -f "$HARDEN_SQL" ]] || { echo "Spark registration repair: missing ${HARDEN_SQL}" >&2; exit 1; }
  echo "Spark registration repair: aligning registration/profile-completion contract..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$PREP_SQL"
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$REPAIR_SQL"
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$HARDEN_SQL"
else
  echo "Spark registration repair: contract is current."
fi

compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "NOTIFY pgrst, 'reload schema';" >/dev/null

state="$(contract_state)"
[[ "$state" == "ready" ]] || {
  echo "Spark registration repair: validation failed after repair." >&2
  exit 1
}

echo "Spark registration repair: registration security contract is ready."
