#!/usr/bin/env bash
# Repair only unreadable Bale keys with zero dependent ciphertext. Never reset Vault.
set -Eeuo pipefail
mode="${1:---check}"
container="${2:-supabase-db}"
db_user="${BALE_REPAIR_DB_USER:-postgres}"
[[ "$db_user" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo 'Invalid DB user.' >&2; exit 2; }
[[ "$mode" == --check || "$mode" == --apply ]] || { echo 'Use --check or --apply.' >&2; exit 2; }
(( $# <= 2 )) || { echo 'Usage: repair-bale-link-vault.sh [--check|--apply] [DB_CONTAINER]' >&2; exit 2; }
[[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid container name.' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
if [[ "$mode" == --check ]]; then
 docker exec -i "$container" psql -X -P pager=off -U "$db_user" -d postgres -v ON_ERROR_STOP=1 < "$script_dir/diagnose-bale-link.sql"
 exit 0
fi
migration="$script_dir/../../supabase/migrations/20261107163952_repair_unreadable_bale_vault_keys_without_ciphertext.sql"
[[ -r "$migration" ]] || { echo 'Repair migration missing; update the checkout.' >&2; exit 1; }
{
 printf '%s\n' 'BEGIN;'
 cat "$migration"
 cat <<'SQL'
INSERT INTO supabase_migrations.schema_migrations(version,name)
SELECT '20261107163952','repair_unreadable_bale_vault_keys_without_ciphertext'
WHERE NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261107163952' OR name='repair_unreadable_bale_vault_keys_without_ciphertext');
COMMIT;
SQL
} | docker exec -i "$container" psql -X -U "$db_user" -d postgres -v ON_ERROR_STOP=1
printf '%s\n' 'Scoped Bale key recovery finished. Other Vault secrets were not changed.'
