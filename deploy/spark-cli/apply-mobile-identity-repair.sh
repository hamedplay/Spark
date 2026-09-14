#!/usr/bin/env bash
set -Eeuo pipefail

SPARK_ROOT="${SPARK_ROOT:-/opt/spark}"
SUPABASE_ROOT="${SUPABASE_ROOT:-/opt/spark-supabase}"
DB_REPAIR_ROOT="${SPARK_ROOT}/deploy/spark-cli/db-repairs"
CLASSIFIER_REPAIR="${DB_REPAIR_ROOT}/20260914145500_align_mobile_identity_sync_classifier.sql"

[[ ${EUID:-$(id -u)} -eq 0 ]] || exec sudo -E "$0" "$@"
[[ -f "${SUPABASE_ROOT}/docker-compose.yml" ]] || {
  echo "Spark mobile identity repair: Supabase compose not found at ${SUPABASE_ROOT}." >&2
  exit 1
}

compose() {
  (cd "$SUPABASE_ROOT" && docker compose "$@")
}

if ! compose ps --status running --services | grep -Fxq db; then
  echo "Spark mobile identity repair: database container is not running." >&2
  exit 1
fi

classifier_state() {
  compose exec -T db psql -X -U postgres -d postgres -Atqc \
    "SELECT CASE
       WHEN to_regprocedure('public.bulk_classify_phone_sync(boolean)') IS NOT NULL
        AND position('IDENTITY_REPAIR_REQUIRED' in pg_get_functiondef('public.bulk_classify_phone_sync(boolean)'::regprocedure)) > 0
        AND position('get_phone_auth_identity_state_v1' in pg_get_functiondef('public.bulk_classify_phone_sync(boolean)'::regprocedure)) > 0
        AND has_function_privilege('service_role', 'public.bulk_classify_phone_sync(boolean)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.bulk_classify_phone_sync(boolean)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.bulk_classify_phone_sync(boolean)', 'EXECUTE')
       THEN 'ready' ELSE 'stale' END;"
}

state="$(classifier_state 2>/dev/null || true)"
if [[ "$state" != "ready" ]]; then
  [[ -f "$CLASSIFIER_REPAIR" ]] || {
    echo "Spark mobile identity repair: required repair asset not found: ${CLASSIFIER_REPAIR}" >&2
    exit 1
  }

  echo "Spark mobile identity repair: aligning phone identity classifier..."
  compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <"$CLASSIFIER_REPAIR"
else
  echo "Spark mobile identity repair: classifier contract is current."
fi

compose exec -T db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "NOTIFY pgrst, 'reload schema';" >/dev/null

state="$(classifier_state)"
[[ "$state" == "ready" ]] || {
  echo "Spark mobile identity repair: validation failed after repair." >&2
  exit 1
}

echo "Spark mobile identity repair: classifier is ready."
