#!/usr/bin/env bash
# Scoped, atomic network-evidence upgrade. Never replays unrelated historical migrations.
set -Eeuo pipefail
mode="${1:---check}"
case "$mode" in --check|--apply) ;; *) echo 'Expected --check or --apply' >&2; exit 2 ;; esac
container="${2:-supabase-db}"
(( $# <= 2 )) && [[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid DB container arguments.' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ "$mode" == --check ]]; then
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select version,name from supabase_migrations.schema_migrations where version in ('20261104090809','20261104093610') order by version;
select to_regprocedure('public.record_my_session_connection_v1(jsonb)') is not null as browser_context_rpc,
 to_regprocedure('public.record_session_connection_service_v1(uuid,uuid,jsonb)') is not null as login_context_rpc,
 exists(select from pg_trigger where tgrelid='auth.sessions'::regclass and tgname='spark_remember_session_end') as session_end_trigger,
 exists(select from pg_constraint where conrelid='public.security_audit_events'::regclass and conname='security_audit_events_ip_address_null') as security_ip_privacy_preserved;
select to_regclass('private.session_connection_context') is not null as installed \gset
\if :installed
select count(*) as observations,count(*) filter(where initial_ip is not null) as with_initial_ip,
 count(*) filter(where last_ip is not null) as with_latest_ip from private.session_connection_context;
\endif
SQL
  exit 0
fi
{
  cat <<'SQL'
begin;
select pg_advisory_xact_lock(hashtextextended('spark.session_connection.upgrade',0));
do $$ begin
 if to_regprocedure('private.get_user_session_security_state_impl(uuid)') is null
 or to_regprocedure('public.record_my_session_context_v1()') is null
 or to_regprocedure('private.event_client_ip_v1(text)') is null then
 raise exception 'SESSION_CONNECTION_PREREQUISITE_MISSING'; end if;
end $$;
SQL
  for name in session_connection_evidence preserve_security_event_ip_privacy; do
    case "$name" in session_connection_evidence) version=20261104090809 ;; *) version=20261104093610 ;; esac
    migration="$script_dir/../../supabase/migrations/${version}_${name}.sql"
    [[ -r "$migration" ]] || { echo 'Session connection migration missing; update the checkout.' >&2; exit 1; }
    printf '%s\n' "select exists(select from supabase_migrations.schema_migrations where version='$version') as applied \gset" '\if :applied' '\else'
    cat "$migration"
    printf '%s\n' "insert into supabase_migrations.schema_migrations(version,name) values('$version','$name');" '\endif'
  done
  cat <<'SQL'
notify pgrst,'reload schema';
commit;
SQL
} | docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
printf '%s\n' 'Session connection upgrade complete. Deploy the matching frontend, functions and ingress headers.'
