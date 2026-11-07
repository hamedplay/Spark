#!/usr/bin/env bash
# Only initialize absent Bale link keys; existing Vault values are never printed or rotated.
set -Eeuo pipefail
mode="${1:---check}"
container="${2:-supabase-db}"
[[ "$mode" == --check || "$mode" == --apply ]] || { echo 'Use --check or --apply.' >&2; exit 2; }
(( $# <= 2 )) || { echo 'Usage: apply-bale-link-crypto.sh [--check|--apply] [DB_CONTAINER]' >&2; exit 2; }
[[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid container name.' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
if [[ "$mode" == --check ]]; then
 docker exec -i "$container" psql -X -P pager=off -U postgres -d postgres -v ON_ERROR_STOP=1 < "$script_dir/diagnose-bale-link.sql"
 exit 0
fi
migration="$script_dir/../../supabase/migrations/20261107161830_initialize_missing_bale_link_crypto_keys.sql"
[[ -r "$migration" ]] || { echo 'Migration file missing; update the checkout.' >&2; exit 1; }
{
 printf '%s\n' 'BEGIN;'
 cat "$migration"
 cat <<'SQL'
INSERT INTO supabase_migrations.schema_migrations(version,name)
SELECT '20261107161830','initialize_missing_bale_link_crypto_keys'
WHERE NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261107161830' OR name='initialize_missing_bale_link_crypto_keys');
COMMIT;
SQL
} | docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
printf '%s\n' 'Bale link keys are ready. Existing keys and account mappings were preserved.'
