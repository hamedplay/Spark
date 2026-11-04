#!/usr/bin/env bash
# Apply only the new note-delivery migration and configure the Application worker URL.
set -Eeuo pipefail
mode="${1:---check}"
container="${2:-supabase-db}"
worker_url="${3:-}"
[[ "$mode" == --check || "$mode" == --apply ]] || { echo 'Use --check or --apply.' >&2; exit 2; }
(( $# <= 3 )) || { echo 'Usage: bash apply-note-reminder-delivery.sh [--check|--apply] [DB_CONTAINER] [HTTPS_WORKER_URL]' >&2; exit 2; }
[[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid container name.' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
migration="$script_dir/../../supabase/migrations/20261104070037_note_reminder_recipients_and_delivery.sql"
payload_migration="$script_dir/../../supabase/migrations/20261104070501_keep_note_reminder_bale_payloads_small.sql"
if [[ "$mode" == --check ]]; then
 docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select exists(select from supabase_migrations.schema_migrations where version='20261104070037') as migration_applied,
 exists(select from supabase_migrations.schema_migrations where version='20261104070501') as compact_payload_migration_applied,
 to_regclass('private.note_reminder_deliveries') is not null as delivery_queue_present,
 to_regprocedure('private.run_note_reminder_tick()') is not null as scheduler_present;
SQL
 exit 0
fi
[[ "$worker_url" =~ ^https://[^/?#@[:space:]]+/functions/v1/note-reminder-worker$ ]] || { echo 'An HTTPS Application worker URL is required.' >&2; exit 2; }
[[ -r "$migration" && -r "$payload_migration" ]] || { echo 'Migration file missing; update the checkout.' >&2; exit 1; }
{
 cat <<'SQL'
begin;
select pg_advisory_xact_lock(hashtextextended('spark.note_reminder_delivery_upgrade',0));
do $$ begin
 if not exists(select from information_schema.columns where table_schema='public' and table_name='notes' and column_name='remind_at') then
  raise exception 'NOTE_REMINDER_BASE_MIGRATION_MISSING: apply 20261104051915_add_note_reminders first';
 end if;
end $$;
select exists(select from supabase_migrations.schema_migrations where version='20261104070037') as applied \gset
\if :applied
 \echo 'Note reminder delivery migration already applied.'
\else
SQL
 cat "$migration"
 cat <<'SQL'
insert into supabase_migrations.schema_migrations(version,name) values('20261104070037','note_reminder_recipients_and_delivery');
\endif
select exists(select from supabase_migrations.schema_migrations where version='20261104070501') as optimized \gset
\if :optimized
 \echo 'Note reminder payload optimization already applied.'
\else
SQL
 cat "$payload_migration"
 cat <<'SQL'
insert into supabase_migrations.schema_migrations(version,name) values('20261104070501','keep_note_reminder_bale_payloads_small');
\endif
select private.configure_note_reminder_worker(:'worker_url');
notify pgrst,'reload schema';
commit;
SQL
} | docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v worker_url="$worker_url"
printf '%s\n' 'Note reminder delivery configured. Deploy note-reminder-worker on the Application node as well.'
