#!/usr/bin/env bash
set -Eeuo pipefail

SPARK_ROOT="${SPARK_ROOT:-/opt/spark}"
SUPABASE_ROOT="${SUPABASE_ROOT:-/opt/spark-supabase}"
DB_REPAIR_ROOT="${SPARK_ROOT}/deploy/spark-cli/db-repairs"
MFA_POLICY_REPAIR="${DB_REPAIR_ROOT}/20260914152500_fix_mfa_policy_console_contract.sql"

[[ ${EUID:-$(id -u)} -eq 0 ]] || exec sudo -E "$0" "$@"
[[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
  echo "Spark MFA policy repair: Supabase compose not found at ${SUPABASE_ROOT}." >&2
  exit 1
}

compose() {
  (cd "$SUPABASE_ROOT" && docker compose "$@")
}

if ! compose ps --status running --services | grep -Fxq db; then
  echo "Spark MFA policy repair: database container is not running." >&2
  exit 1
fi

contract_state() {
  compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT CASE
       WHEN to_regprocedure('private.set_auth_security_settings_patch(integer,jsonb,text)') IS NOT NULL
        AND position('revoked_at' in pg_get_functiondef('private.set_auth_security_settings_patch(integer,jsonb,text)'::regprocedure)) = 0
        AND position('factor_type = ''totp''' in pg_get_functiondef('private.set_auth_security_settings_patch(integer,jsonb,text)'::regprocedure)) > 0
        AND position('assurance_level = ''aal2''' in pg_get_functiondef('private.set_auth_security_settings_patch(integer,jsonb,text)'::regprocedure)) > 0
        AND to_regprocedure('public.get_mfa_policy_state()') IS NOT NULL
        AND has_function_privilege('authenticated', 'public.get_mfa_policy_state()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.get_mfa_policy_state()', 'EXECUTE')
       THEN 'ready' ELSE 'stale' END;"
}

state="$(contract_state 2>/dev/null || true)"
if [[ "$state" != "ready" ]]; then
  [[ -f "$MFA_POLICY_REPAIR" ]] || {
    echo "Spark MFA policy repair: required repair asset not found: ${MFA_POLICY_REPAIR}" >&2
    exit 1
  }

  echo "Spark MFA policy repair: aligning MFA policy console contract..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$MFA_POLICY_REPAIR"
else
  echo "Spark MFA policy repair: contract is current."
fi

compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "NOTIFY pgrst, 'reload schema';" >/dev/null

state="$(contract_state)"
[[ "$state" == "ready" ]] || {
  echo "Spark MFA policy repair: validation failed after repair." >&2
  exit 1
}

echo "Spark MFA policy repair: MFA policy console is ready."
