#!/usr/bin/env bash
# Apply only the new sender/standard-message migration on an existing notes installation.
set -Eeuo pipefail
mode="${1:---check}"
container="${2:-supabase-db}"
[[ "$mode" == --check || "$mode" == --apply ]] || { echo 'Use --check or --apply.' >&2; exit 2; }
(( $# <= 2 )) || { echo 'Usage: apply-note-message-identity.sh [--check|--apply] [DB_CONTAINER]' >&2; exit 2; }
[[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid container name.' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
migration="$script_dir/../../supabase/migrations/20261107060240_note_sender_identity_and_message_privacy.sql"
identity_cleanup="$script_dir/../../supabase/migrations/20261107061409_preserve_note_sender_snapshots_on_account_deletion.sql"
if [[ "$mode" == --check ]]; then
 docker exec -i "$container" psql -X -P pager=off -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT exists(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261107060240' OR name='note_sender_identity_and_message_privacy') AS migration_applied,
 exists(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261107061409' OR name='preserve_note_sender_snapshots_on_account_deletion') AS identity_cleanup_applied,
 to_regprocedure('public.share_note_v2(uuid,uuid)') IS NOT NULL AS sharing_ready,
 to_regprocedure('public.get_note_delivery_envelope(uuid,uuid)') IS NOT NULL AS worker_payload_ready,
 to_regprocedure('public.get_note_message_details(uuid)') IS NOT NULL AS details_ready;
SQL
 exit 0
fi
[[ -r "$migration" && -r "$identity_cleanup" ]] || { echo 'Migration file missing; update the checkout.' >&2; exit 1; }
{
 cat <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('spark.note_message_identity',0));
SELECT exists(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261107060240' OR name='note_sender_identity_and_message_privacy') AS applied \gset
\if :applied
 \echo 'Note sender/message migration already applied.'
\else
SQL
 cat "$migration"
 cat <<'SQL'
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('20261107060240','note_sender_identity_and_message_privacy');
\endif
SELECT exists(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261107061409' OR name='preserve_note_sender_snapshots_on_account_deletion') AS identity_cleanup_applied \gset
\if :identity_cleanup_applied
 \echo 'Note sender identity cleanup migration already applied.'
\else
SQL
 cat "$identity_cleanup"
 cat <<'SQL'
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('20261107061409','preserve_note_sender_snapshots_on_account_deletion');
\endif
COMMIT;
SQL
} | docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
printf '%s\n' 'Database ready. Deploy the matching frontend and note-reminder-worker together.'
