#!/usr/bin/env bash
# Use only the new syntax-correct event-center migration; preserve old broken SQL unchanged.
# Existing database copies that have the earlier schema can safely reapply these idempotent definitions.
# This never clears logs; the purge operation is an explicit, separately guarded RPC.
set -Eeuo pipefail
mode=--check
if (( $# > 0 )); then mode="$1"; shift; fi
case "$mode" in --check|--apply) ;; *) echo 'Usage: bash apply-event-center-global-db.sh [--check|--apply] [DB_CONTAINER]' >&2; exit 2 ;; esac
(( $# <= 1 )) || { echo 'Expected at most one DB container.' >&2; exit 2; }
container=supabase-db
if (( $# == 1 )); then container="$1"; fi
[[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid DB container name.' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
migration="$script_dir/../../supabase/migrations/20261104060819_repair_event_center_global_migration_sql_terminators.sql"
[[ -r "$migration" ]] || { echo 'Event-center migration file is missing; update the Spark checkout.' >&2; exit 1; }

if [[ "$mode" == --check ]]; then
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select current_database() as database,
  exists(select 1 from supabase_migrations.schema_migrations where version='20261104060819') as migration_applied,
  to_regprocedure('public.get_event_center_summary_v1()') is not null as total_summary_rpc_present,
  to_regprocedure('public.purge_event_center_history_v1(text)') is not null as admin_purge_rpc_present,
  to_regclass('private.event_center_purge_receipts') is not null as purge_receipts_present;
SQL
  exit 0
fi

{
  cat <<'SQL'
begin;
select pg_advisory_xact_lock(hashtextextended('spark.event_center.global_upgrade',0));
do $$
begin
  if to_regprocedure('public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)') is null
     or to_regprocedure('public.record_my_session_context_v1()') is null
     or to_regprocedure('public.write_audit_log(text,text,text,text,text,text,text,text,text)') is null then
    raise exception 'EVENT_CENTER_PREREQUISITE_MISSING';
  end if;
end $$;
select exists(select 1 from supabase_migrations.schema_migrations where version='20261104060819') as applied \gset
\if :applied
  \echo 'Event-center global upgrade already registered; checking required objects.'
\else
SQL
  cat "$migration"
  cat <<'SQL'
insert into supabase_migrations.schema_migrations(version,name)
values('20261104060819','repair_event_center_global_migration_sql_terminators');
\endif
do $$
begin
  if to_regprocedure('public.get_event_center_summary_v1()') is null
     or to_regprocedure('public.purge_event_center_history_v1(text)') is null
     or to_regclass('private.event_center_purge_receipts') is null then
    raise exception 'EVENT_CENTER_GLOBAL_UPGRADE_INCOMPLETE';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
SQL
} | docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
printf '%s\n' 'Event-center global upgrade complete. No event history was deleted.'
