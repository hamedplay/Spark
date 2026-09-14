#!/usr/bin/env bash
set -Eeuo pipefail

SPARK_ROOT="${SPARK_ROOT:-/opt/spark}"
SUPABASE_ROOT="${SUPABASE_ROOT:-/opt/spark-supabase}"
BASE_REPAIR_SQL="${SPARK_ROOT}/deploy/spark-cli/db-repairs/20260914180500_align_custom_sms_mfa_contract.sql"
METHOD_REPAIR_SQL="${SPARK_ROOT}/deploy/spark-cli/db-repairs/20260914224500_user_selectable_mfa_method.sql"

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

base_contract_state() {
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
        AND position('supported_factors' in pg_get_functiondef(to_regprocedure('public.get_custom_mfa_readiness()'))) > 0
        AND position('app.mfa_pepper' in pg_get_functiondef(to_regprocedure('public.get_custom_mfa_readiness()'))) = 0
        AND position('bale_bot_token' in pg_get_functiondef(to_regprocedure('public.get_custom_mfa_readiness()'))) = 0
        AND has_function_privilege('service_role', to_regprocedure('public.get_custom_mfa_readiness()'), 'EXECUTE')
        AND NOT has_function_privilege('authenticated', to_regprocedure('public.get_custom_mfa_readiness()'), 'EXECUTE')
        AND NOT has_function_privilege('anon', to_regprocedure('public.get_custom_mfa_readiness()'), 'EXECUTE')
       THEN 'ready' ELSE 'stale' END;"
}

method_contract_state() {
  compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT CASE
       WHEN to_regclass('public.mfa_switch_intents') IS NOT NULL
        AND EXISTS (
              SELECT 1
              FROM pg_trigger
              WHERE tgrelid = 'public.profiles'::regclass
                AND tgname = 'trg_guard_canonical_mfa_method'
                AND NOT tgisinternal
            )
        AND to_regprocedure('public.get_my_canonical_mfa_state()') IS NOT NULL
        AND to_regprocedure('public.begin_mfa_method_switch(text)') IS NOT NULL
        AND to_regprocedure('public.confirm_mfa_method_switch_current(uuid)') IS NOT NULL
        AND to_regprocedure('private.activate_canonical_totp_mfa_impl()') IS NOT NULL
        AND to_regprocedure('public.consume_sms_mfa_challenge_v3(uuid,uuid,uuid,text)') IS NOT NULL
        AND position('sms_selectable' in pg_get_functiondef(to_regprocedure('private.get_my_canonical_mfa_state_impl()'))) > 0
        AND position('v_totp_selectable' in pg_get_functiondef(to_regprocedure('private.begin_mfa_method_switch_impl(text)'))) > 0
        AND position('CURRENT_FACTOR_PROOF_REQUIRED' in pg_get_functiondef(to_regprocedure('private.confirm_mfa_method_switch_current_impl(uuid)'))) > 0
        AND position('TARGET_FACTOR_PROOF_REQUIRED' in pg_get_functiondef(to_regprocedure('private.activate_canonical_totp_mfa_impl()'))) > 0
        AND position('mfa_method_switch' in pg_get_functiondef(to_regprocedure('public.consume_sms_mfa_challenge_v3(uuid,uuid,uuid,text)'))) > 0
        AND has_function_privilege('authenticated', to_regprocedure('public.get_my_canonical_mfa_state()'), 'EXECUTE')
        AND has_function_privilege('authenticated', to_regprocedure('public.begin_mfa_method_switch(text)'), 'EXECUTE')
        AND has_function_privilege('authenticated', to_regprocedure('public.confirm_mfa_method_switch_current(uuid)'), 'EXECUTE')
        AND NOT has_function_privilege('anon', to_regprocedure('public.get_my_canonical_mfa_state()'), 'EXECUTE')
        AND NOT has_function_privilege('anon', to_regprocedure('public.begin_mfa_method_switch(text)'), 'EXECUTE')
        AND NOT has_function_privilege('anon', to_regprocedure('public.confirm_mfa_method_switch_current(uuid)'), 'EXECUTE')
        AND has_function_privilege('service_role', to_regprocedure('public.consume_sms_mfa_challenge_v3(uuid,uuid,uuid,text)'), 'EXECUTE')
        AND NOT has_function_privilege('authenticated', to_regprocedure('public.consume_sms_mfa_challenge_v3(uuid,uuid,uuid,text)'), 'EXECUTE')
        AND NOT has_function_privilege('anon', to_regprocedure('public.consume_sms_mfa_challenge_v3(uuid,uuid,uuid,text)'), 'EXECUTE')
       THEN 'ready' ELSE 'stale' END;"
}

base_state="$(base_contract_state 2>/dev/null || true)"
if [[ "$base_state" != "ready" ]]; then
  [[ -f "$BASE_REPAIR_SQL" ]] || {
    echo "Spark custom MFA repair: base repair asset not found: ${BASE_REPAIR_SQL}" >&2
    exit 1
  }
  echo "Spark custom MFA repair: aligning SMS-only custom MFA contract..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$BASE_REPAIR_SQL"
else
  echo "Spark custom MFA repair: SMS base contract is current."
fi

method_state="$(method_contract_state 2>/dev/null || true)"
if [[ "$method_state" != "ready" ]]; then
  [[ -f "$METHOD_REPAIR_SQL" ]] || {
    echo "Spark custom MFA repair: method repair asset not found: ${METHOD_REPAIR_SQL}" >&2
    exit 1
  }
  echo "Spark custom MFA repair: aligning user-selectable TOTP/SMS method contract..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$METHOD_REPAIR_SQL"
else
  echo "Spark custom MFA repair: user-selectable method contract is current."
fi

compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "NOTIFY pgrst, 'reload schema';" >/dev/null

base_state="$(base_contract_state)"
method_state="$(method_contract_state)"
[[ "$base_state" == "ready" && "$method_state" == "ready" ]] || {
  echo "Spark custom MFA repair: validation failed after repair." >&2
  exit 1
}

echo "Spark custom MFA repair: SMS MFA and user-selectable method contracts are ready."
