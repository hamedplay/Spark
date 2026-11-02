#!/usr/bin/env bash
# Upgrade only the existing event center: Auth audit source and verified session context.
# No login attempts, credentials, runtime upgrade or unrelated migration.
set -Eeuo pipefail
mode="${1:---check}"
case "$mode" in
  --check|--apply) shift "$(( $# > 0 ? 1 : 0 ))" ;;
  *) echo 'Usage: bash apply-event-center-db.sh [--check|--apply] [DB_CONTAINER]' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo 'Expected at most one DB container.' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
migrations=(
  '20261102042055_event_center_authentication_logs'
  '20261102043627_event_center_client_context'
)
for entry in "${migrations[@]}"; do
  [[ -r "$script_dir/../../supabase/migrations/${entry}.sql" ]] || {
    echo "Event-center migration missing: $entry. Update the Spark checkout." >&2; exit 1;
  }
done
container="${1:-}"
if [[ -z "$container" ]]; then
  inventory="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}} {{.Label "com.docker.compose.service"}}')"
  mapfile -t candidates < <(awk '$3 == "supabase-db" || ($2 ~ /(^|\/)supabase\/postgres:/ && $4 == "db") {print $1}' <<< "$inventory")
  [[ ${#candidates[@]} -eq 1 ]] || {
    echo 'Could not select exactly one running Supabase database. Pass DB_CONTAINER explicitly.' >&2; exit 1;
  }
  container="${candidates[0]}"
fi
[[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid container name.' >&2; exit 2; }
if [[ "$mode" == --check ]]; then
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select current_database() as database,
  exists(select 1 from supabase_migrations.schema_migrations where version='20261102042055') as migration_applied,
  to_regprocedure('public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)') is not null as rpc_present,
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='get_event_center_v1' and position('auth.audit_log_entries' in p.prosrc)>0) as auth_source_present,
  exists(select 1 from supabase_migrations.schema_migrations where version='20261102043627') as client_context_migration_applied,
  to_regclass('private.event_session_context') is not null as session_context_present,
  to_regprocedure('public.record_my_session_context_v1()') is not null as session_context_rpc_present;
select count(*) as auth_login_rows_last_7_days from auth.audit_log_entries
  where payload->>'action'='login' and created_at>=now()-interval '7 days';
SQL
  exit 0
fi
{
  cat <<'SQL'
begin;
select pg_advisory_xact_lock(hashtextextended('spark.event_center.install',0));
do $$ begin
  if to_regprocedure('public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)') is null then
    raise exception 'EVENT_CENTER_BASE_REQUIRED: public event-center RPC missing; nothing changed';
  end if;
end $$;
SQL
  for entry in "${migrations[@]}"; do
    version="${entry%%_*}"
    name="${entry#*_}"
    printf "select exists(select 1 from supabase_migrations.schema_migrations where version='%s') as migration_applied \\gset\n" "$version"
    cat <<'SQL'
\if :migration_applied
  \echo 'Event-center upgrade already applied; verifying and refreshing API cache.'
\else
SQL
    cat "$script_dir/../../supabase/migrations/${entry}.sql"
    printf "insert into supabase_migrations.schema_migrations(version,name) values('%s','%s');\n" "$version" "$name"
    printf '\\endif\n'
  done
  cat <<'SQL'
-- An existing base without its old history is supported; never fabricate that history.
do $$ begin
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='get_event_center_v1' and position('auth.audit_log_entries' in p.prosrc)>0) then
    raise exception 'EVENT_CENTER_AUTH_SOURCE_MISSING';
  end if;
  if to_regclass('private.event_session_context') is null or to_regprocedure('public.record_my_session_context_v1()') is null then
    raise exception 'EVENT_CENTER_CLIENT_CONTEXT_MISSING';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
select to_regprocedure('public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)') as event_center_rpc;
SQL
} | docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
printf '%s\n' 'Event-center Auth source and session context ready; schema reload requested. Verify the event page with an authorized user.'
