-- New migration only; connected non-production copy version: 20261104053139.

-- Event center: exact all-history stats, guarded administrator purge, canonical trusted ingress IP.

CREATE OR REPLACE FUNCTION private.event_center_summary_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_summary jsonb;
begin
  if not (private.current_user_has_permission_v1('config_users.group_events')
      or private.current_user_has_permission_v1('config_audit.audit_log')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  with event_rows as (
    select a.user_id as actor, a.action as kind, a.severity, null::text as result from public.audit_log a
    union all
    select coalesce(s.actor_user_id,s.user_id),s.event_type,s.severity,s.result from public.security_audit_events s
    union all
    select case when (a.payload->>'actor_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (a.payload->>'actor_id')::uuid else null::uuid end,
      'auth.' || (a.payload->>'action'), 'info'::text,
      case when a.payload->>'action' in ('login','logout','user_signedup','user_updated_password','user_deleted','mfa_code_login')
        then 'success'::text else null::text end
    from auth.audit_log_entries a where a.payload->>'action' in ('login','logout','user_signedup','user_deleted','user_modified','user_updated_password','user_invited','invite_accepted','user_recovery_requested','user_reauthenticate_requested','user_confirmation_requested','user_repeated_signup','generate_recovery_codes','factor_in_progress','factor_unenrolled','challenge_created','verification_attempted','factor_deleted','recovery_codes_deleted','factor_updated','mfa_code_login','identity_unlinked')
    union all
    select c.user_id,'session.first_full_access','info'::text,'success'::text from private.event_session_context c
  )
  select jsonb_build_object(
    'total_events', count(*),
    'login_events', count(*) filter (where kind in ('auth.login','auth.mfa_code_login')),
    'attention_events', count(*) filter (where severity in ('warning','error','critical') or result in ('denied','failure','error')),
    'denied_events', count(*) filter (where result = 'denied'),
    'unique_actors', count(distinct actor)
  ) into v_summary from event_rows;
  return v_summary;
end;
$function$

CREATE OR REPLACE FUNCTION public.get_event_center_summary_v1()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.event_center_summary_v1(); $function$

revoke all on function private.event_center_summary_v1() from public, anon, authenticated, service_role;

revoke all on function public.get_event_center_summary_v1() from public, anon, authenticated, service_role;

grant execute on function public.get_event_center_summary_v1() to authenticated, service_role;

create table if not exists private.event_center_purge_receipts (id uuid primary key default gen_random_uuid(), deleted_at timestamptz not null default now(), actor_user_id uuid not null, app_deleted bigint not null, security_deleted bigint not null, auth_deleted bigint not null, session_deleted bigint not null);

alter table private.event_center_purge_receipts enable row level security;

revoke all on table private.event_center_purge_receipts from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.purge_event_center_history_v1(p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_app bigint;
  v_security bigint;
  v_auth bigint;
  v_session bigint;
begin
  if v_actor is null or not private.is_current_session_fully_authorized()
    or not private.is_current_user_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_confirmation is distinct from 'DELETE ALL EVENTS' then
    raise exception 'CONFIRMATION_REQUIRED' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(20261104, 1);
  delete from public.audit_log;
  get diagnostics v_app = row_count;
  delete from public.security_audit_events;
  get diagnostics v_security = row_count;
  delete from auth.audit_log_entries a where a.payload->>'action' in ('login','logout','user_signedup','user_deleted','user_modified','user_updated_password','user_invited','invite_accepted','user_recovery_requested','user_reauthenticate_requested','user_confirmation_requested','user_repeated_signup','generate_recovery_codes','factor_in_progress','factor_unenrolled','challenge_created','verification_attempted','factor_deleted','recovery_codes_deleted','factor_updated','mfa_code_login','identity_unlinked');
  get diagnostics v_auth = row_count;
  delete from private.event_session_context;
  get diagnostics v_session = row_count;
  insert into private.event_center_purge_receipts(actor_user_id,app_deleted,security_deleted,auth_deleted,session_deleted)
    values (v_actor,v_app,v_security,v_auth,v_session);
  return jsonb_build_object('deleted_events',v_app+v_security+v_auth+v_session,
    'app_deleted',v_app,'security_deleted',v_security,'auth_deleted',v_auth,'session_deleted',v_session);
end;
$function$

CREATE OR REPLACE FUNCTION public.purge_event_center_history_v1(p_confirmation text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.purge_event_center_history_v1(p_confirmation); $function$

revoke all on function private.purge_event_center_history_v1(text) from public, anon, authenticated, service_role;

revoke all on function public.purge_event_center_history_v1(text) from public, anon, authenticated, service_role;

grant execute on function public.purge_event_center_history_v1(text) to authenticated;

CREATE OR REPLACE FUNCTION public.record_my_session_context_v1()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_sid uuid;
  v_state jsonb;
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  v_state := private.get_my_auth_access_state_v3();
  if coalesce(v_state->>'access_level','BLOCKED') <> 'FULL' then
    raise exception 'FULL_SESSION_REQUIRED' using errcode='42501';
  end if;
  begin v_sid := nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then return false; end;
  if v_sid is null or v_state->>'user_id' is distinct from v_uid::text
    or v_state->>'session_id' is distinct from v_sid::text then return false; end if;
  if exists(select 1 from private.event_session_context where session_id=v_sid) then return true; end if;
  begin v_headers := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when invalid_text_representation then v_headers := '{}'::jsonb; end;
  v_ip := private.event_client_ip_v1(v_headers->>'x-spark-client-ip');
  insert into private.event_session_context(session_id,user_id,ip_address,ip_source,user_agent)
    values(v_sid,v_uid,v_ip::inet,case when v_ip is not null then 'proxy_header' else null end,
           nullif(left(v_headers->>'user-agent',512),''))
    on conflict (session_id) do nothing;
  return true;
end;
$function$

revoke all on function public.record_my_session_context_v1() from public, anon;

grant execute on function public.record_my_session_context_v1() to authenticated;

CREATE OR REPLACE FUNCTION public.write_audit_log(p_module text, p_action text, p_entity_name text DEFAULT NULL::text, p_entity_id text DEFAULT NULL::text, p_details text DEFAULT NULL::text, p_severity text DEFAULT 'info'::text, p_user_agent text DEFAULT NULL::text, p_url text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_user_name text;
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_action,'')),'') is null then
    raise exception 'AUDIT_ACTION_REQUIRED' using errcode='22023';
  end if;
  if coalesce(p_severity,'info') not in ('info','warning','error','critical') then
    raise exception 'INVALID_AUDIT_SEVERITY' using errcode='22023';
  end if;
  select coalesce(nullif(btrim(full_name),''),nullif(btrim(email),'')) into v_user_name
    from public.profiles where user_id = v_uid limit 1;
  begin v_headers := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when others then v_headers := '{}'::jsonb; end;
  v_ip := private.event_client_ip_v1(v_headers->>'x-spark-client-ip');
  insert into public.audit_log(user_id,user_name,ip_address,user_agent,module,action,entity_name,entity_id,
    details,severity,url,referrer)
  values(v_uid,v_user_name,v_ip,left(p_user_agent,512),p_module,p_action,p_entity_name,p_entity_id,
    p_details,coalesce(p_severity,'info'),p_url,p_referrer)
  returning id into v_id;
  return v_id;
end;
$function$

grant execute on function public.write_audit_log(text,text,text,text,text,text,text,text,text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

