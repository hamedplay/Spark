#!/usr/bin/env bash
set -Eeuo pipefail

SPARK_ROOT="${SPARK_ROOT:-/opt/spark}"
SUPABASE_ROOT="${SUPABASE_ROOT:-/opt/spark-supabase}"
REPAIR_SQL="${SPARK_ROOT}/deploy/spark-cli/db-repairs/20260914180500_align_custom_sms_mfa_contract.sql"

[[ ${EUID:-$(id -u)} -eq 0 ]] || exec sudo -E "$0" "$@"
[[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
  echo "Spark custom MFA repair: Supabase compose not found at ${SUPABASE_ROOT}." >&2
  exit 1
}

compose() {
  (cd "$SUPABASE_ROOT" && docker compose "$@")
}

if ! compose ps --status running --services | grep -Fxq db; then
  echo "Spark custom MFA repair: database container is not running." >&2
  exit 1
fi

contract_state() {
  compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT CASE
       WHEN EXISTS (
              SELECT 1
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = 'public'
                AND t.relname = 'auth_security_settings'
                AND c.conname = 'auth_security_settings_custom_mfa_sms_only_chk'
            )
        AND to_regprocedure('public.get_custom_mfa_readiness()') IS NOT NULL
        AND position('supported_factors' in pg_get_functiondef('public.get_custom_mfa_readiness()'::regprocedure)) > 0
        AND position('app.mfa_pepper' in pg_get_functiondef('public.get_custom_mfa_readiness()'::regprocedure)) = 0
        AND position('bale_bot_token' in pg_get_functiondef('public.get_custom_mfa_readiness()'::regprocedure)) = 0
        AND has_function_privilege('service_role', 'public.get_custom_mfa_readiness()', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.get_custom_mfa_readiness()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.get_custom_mfa_readiness()', 'EXECUTE')
       THEN 'ready' ELSE 'stale' END;"
}

state="$(contract_state 2>/dev/null || true)"
if [[ "$state" != "ready" ]]; then
  [[ -f "$REPAIR_SQL" ]] || {
    echo "Spark custom MFA repair: repair asset not found: ${REPAIR_SQL}" >&2
    exit 1
  }
  echo "Spark custom MFA repair: aligning SMS-only custom MFA contract..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$REPAIR_SQL"
else
  echo "Spark custom MFA repair: contract is current."
fi

compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "NOTIFY pgrst, 'reload schema';" >/dev/null

state="$(contract_state)"
[[ "$state" == "ready" ]] || {
  echo "Spark custom MFA repair: validation failed after repair." >&2
  exit 1
}

echo "Spark custom MFA repair: SMS-only custom MFA contract is ready."
