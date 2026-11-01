#!/usr/bin/env bash
# Install only the event-center database migration, or reload its API cache.
# No application deployment, credentials, runtime upgrade or unrelated migration.
set -Eeuo pipefail
mode="${1:---check}"
case "$mode" in
  --check|--apply) shift "$(( $# > 0 ? 1 : 0 ))" ;;
  *) echo 'Usage: bash apply-event-center-db.sh [--check|--apply] [DB_CONTAINER]' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo 'Expected at most one DB container.' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
migration="$script_dir/../../supabase/migrations/20261101182857_security_event_center.sql"
[[ -r "$migration" ]] || { echo 'Event-center migration missing. Run from a complete current Spark checkout.' >&2; exit 1; }
container="${1:-}"
if [[ -z "$container" ]]; then
  inventory="$(docker ps --format '{{.ID}} {{.Image}} {{.Label "com.docker.compose.service"}}')"
  mapfile -t candidates < <(awk '$2 ~ /(^|\/)supabase\/postgres:/ && $3 == "db" {print $1}' <<< "$inventory")
  [[ ${#candidates[@]} -eq 1 ]] || {
    echo 'Could not select exactly one running Supabase database. Pass DB_CONTAINER explicitly.' >&2; exit 1;
  }
  container="${candidates[0]}"
fi
[[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid container name.' >&2; exit 2; }
if [[ "$mode" == --check ]]; then
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select current_database() as database,
  exists(select 1 from supabase_migrations.schema_migrations where version='20261101182857') as migration_applied,
  to_regprocedure('public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)') is not null as rpc_present;
SQL
  exit 0
fi
{
  cat <<'SQL'
begin;
select pg_advisory_xact_lock(hashtextextended('spark.event_center.install',0));
select exists(select 1 from supabase_migrations.schema_migrations where version='20261101182857') as migration_applied,
  to_regprocedure('public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)') is not null as rpc_present \gset
\if :migration_applied
  \if :rpc_present
    \echo 'Migration already applied; refreshing API schema cache.'
  \else
    do $$ begin raise exception 'EVENT_CENTER_SCHEMA_DRIFT: migration recorded but RPC missing; nothing changed'; end $$;
  \endif
\else
  \if :rpc_present
    do $$ begin raise exception 'EVENT_CENTER_HISTORY_DRIFT: RPC exists without migration history; nothing changed'; end $$;
  \else
SQL
  cat "$migration"
  cat <<'SQL'
insert into supabase_migrations.schema_migrations(version,name) values('20261101182857','security_event_center');
  \endif
\endif
-- Verify before committing migration/history or sending the cache notification.
do $$ begin
  if to_regprocedure('private.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)') is null
    or to_regprocedure('public.record_access_denial_service_v1(uuid,text,text)') is null then
    raise exception 'EVENT_CENTER_SCHEMA_INCOMPLETE';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
select to_regprocedure('public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)') as event_center_rpc;
SQL
} | docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
printf '%s\n' 'Event-center database ready; schema reload requested. Retry the event page to verify the authenticated API.'
