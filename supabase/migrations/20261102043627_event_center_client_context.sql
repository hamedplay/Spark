-- Capture only the first observed FULL request per verified session. No historical backfill.
-- Keep raw request context in a private, non-client-readable table; existing audit evidence is unchanged.
do $$ begin
  if to_regprocedure('public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)') is null then
    raise exception 'EVENT_CENTER_BASE_REQUIRED';
  end if;
end $$;

create table private.event_session_context (
  session_id uuid primary key,
  id uuid not null unique default gen_random_uuid(),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  ip_address inet,
  ip_source text check (ip_source in ('proxy_header','forwarded_header')),
  user_agent text check (length(user_agent)<=512)
);
create index event_session_context_created_at_idx on private.event_session_context(created_at desc,id desc);
alter table private.event_session_context enable row level security;
revoke all on private.event_session_context from public,anon,authenticated,service_role;

-- Accept a single host address, never a CIDR, port, arbitrary header string or sentinel IP.
create or replace function private.event_client_ip_v1(p_value text)
returns text language plpgsql immutable set search_path='' as $$
declare v_ip inet;
begin
  if p_value is null or length(p_value)>64 or p_value ~ '[/%,]' then return null; end if;
  begin v_ip:=nullif(btrim(p_value),'')::inet;
  exception when invalid_text_representation then return null; end;
  if v_ip is null or host(v_ip) in ('0.0.0.0','::') then return null; end if;
  return host(v_ip);
end $$;
revoke all on function private.event_client_ip_v1(text) from public,anon,authenticated,service_role;

create or replace function public.record_my_session_context_v1()
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid();
  v_sid uuid;
  v_state jsonb;
  v_headers jsonb:='{}'::jsonb;
  v_ip text;
  v_source text;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  v_state:=private.get_my_auth_access_state_v3();
  if coalesce(v_state->>'access_level','BLOCKED')<>'FULL' then
    raise exception 'FULL_SESSION_REQUIRED' using errcode='42501';
  end if;
  begin v_sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then return false; end;
  if v_sid is null or v_state->>'user_id' is distinct from v_uid::text
    or v_state->>'session_id' is distinct from v_sid::text then return false; end if;
  if exists(select 1 from private.event_session_context where session_id=v_sid) then return true; end if;

  begin v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when invalid_text_representation then v_headers:='{}'::jsonb; end;
  -- Nginx must overwrite this header with $remote_addr; never append caller-supplied XFF.
  v_ip:=private.event_client_ip_v1(v_headers->>'x-spark-client-ip');
  if v_ip is not null then v_source:='proxy_header'; else
    v_ip:=private.event_client_ip_v1(split_part(v_headers->>'x-forwarded-for',',',1));
    if v_ip is not null then v_source:='forwarded_header'; end if;
  end if;
  insert into private.event_session_context(session_id,user_id,ip_address,ip_source,user_agent)
    values(v_sid,v_uid,v_ip::inet,v_source,nullif(left(v_headers->>'user-agent',512),''))
    on conflict (session_id) do nothing;
  return true;
end $$;
revoke all on function public.record_my_session_context_v1() from public,anon,service_role;
grant execute on function public.record_my_session_context_v1() to authenticated;

create or replace function private.get_event_center_v1(
  p_from timestamptz default null,p_to timestamptz default null,p_source text default null,
  p_severity text default null,p_result text default null,p_search text default null,
  p_before_time timestamptz default null,p_before_key text default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  rows_json jsonb;
  more_rows boolean;
  from_time timestamptz := coalesce(p_from,now()-interval '7 days');
  to_time timestamptz := coalesce(p_to,now());
  search_text text := nullif(btrim(p_search),'');
begin
  if not (private.current_user_has_permission_v1('config_users.group_events')
    or private.current_user_has_permission_v1('config_audit.audit_log')) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or to_time<from_time or to_time-from_time>interval '93 days'
    or (p_before_time is null)<>(p_before_key is null) or length(coalesce(search_text,''))>200
    or (p_source is not null and p_source not in ('application','security')) then
    raise exception 'INVALID_FILTER' using errcode='22023';
  end if;
  with combined as (
    select 'application:'||a.id::text event_key,a.id,a.created_at,'application'::text source,
      a.action event_type,coalesce(a.module,'application') category,a.severity,null::text result,
      a.user_id actor_user_id,a.user_name actor_name,null::uuid target_user_id,
      a.ip_address,null::text ip_hash,null::uuid session_id,null::uuid request_id,null::text error_code,
      jsonb_build_object('entity_name',a.entity_name,'entity_id',a.entity_id,
        'details',left(a.details,4000),'user_agent',left(a.user_agent,512),
        'url',split_part(split_part(a.url,'?',1),'#',1),'referrer',split_part(split_part(a.referrer,'?',1),'#',1)) metadata,
      null::jsonb before_state,null::jsonb after_state
    from public.audit_log a where a.created_at>=from_time and a.created_at<=to_time and (p_source is null or p_source='application')
    union all
    select 'security:'||e.id::text,e.id,e.created_at,'security',e.event_type,e.event_category,e.severity,e.result,
      coalesce(e.actor_user_id,e.user_id),p.full_name,e.target_user_id,e.ip_address,e.ip_hash,e.session_id,e.request_id,e.error_code,
      public.sanitize_audit_metadata(e.metadata) || jsonb_strip_nulls(jsonb_build_object(
        'session_context',case when cx.session_id is not null then jsonb_strip_nulls(jsonb_build_object(
          'ip_address',host(cx.ip_address),'ip_source',cx.ip_source,'user_agent',cx.user_agent,'observed_at',cx.created_at)) end,
        'session_device',case when cx.session_id is null and nullif(ss.device_summary,'unknown') is not null
          then jsonb_build_object('user_agent',left(ss.device_summary,512),'source','session_registry') end)),
      public.sanitize_audit_metadata(e.before_state),public.sanitize_audit_metadata(e.after_state)
    from public.security_audit_events e left join public.profiles p on p.user_id=coalesce(e.actor_user_id,e.user_id)
    left join private.event_session_context cx on cx.session_id=e.session_id and cx.user_id=coalesce(e.actor_user_id,e.user_id)
    left join public.session_security_state ss on ss.session_id=e.session_id and ss.user_id=coalesce(e.actor_user_id,e.user_id)
    where e.created_at>=from_time and e.created_at<=to_time and (p_source is null or p_source='security')
    union all
    -- Read the existing Auth audit source; never copy credentials, traits or raw payloads.
    -- Successful identity authentication is not a claim of FULL application/MFA access.
    select 'authentication:'||a.id::text,a.id,a.created_at,'security',
      'auth.'||(a.payload->>'action'),
      case when a.payload->>'action' in ('challenge_created','verification_attempted','factor_in_progress',
        'factor_unenrolled','factor_deleted','factor_updated','generate_recovery_codes','recovery_codes_deleted','mfa_code_login')
        then 'mfa' when a.payload->>'action'='user_recovery_requested' then 'recovery' else 'auth' end,
      'info',
      case when a.payload->>'action' in ('login','logout','user_signedup','user_updated_password','user_deleted','mfa_code_login')
        then 'success'::text else null::text end,
      actor.user_id,coalesce(nullif(p.full_name,''),nullif(p.username,'')),
      null::uuid,private.event_client_ip_v1(a.ip_address),null::text,null::uuid,null::uuid,null::text,
      jsonb_strip_nulls(jsonb_build_object('source','auth_service','auth_action',a.payload->>'action',
        'auth_provider',case when coalesce(a.payload::jsonb->'traits'->>'provider',a.payload::jsonb->'traits'->>'provider_type') ~ '^[a-z_]{1,40}$'
          then coalesce(a.payload::jsonb->'traits'->>'provider',a.payload::jsonb->'traits'->>'provider_type') else null end,
        'verification_scope','identity_service',
        'ip_source',case when private.event_client_ip_v1(a.ip_address) is not null then 'auth_service' end,
        'user_agent',nullif(left(a.payload->>'user_agent',512),''),
        'details',case a.payload->>'action' when 'login' then 'ورود کاربر در سرویس احراز هویت ثبت شد.'
          when 'logout' then 'خروج کاربر در سرویس احراز هویت ثبت شد.' else null end)),
      null::jsonb,null::jsonb
    from auth.audit_log_entries a
    cross join lateral (select case when a.payload->>'actor_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (a.payload->>'actor_id')::uuid else null::uuid end user_id) actor
    left join public.profiles p on p.user_id=actor.user_id
    where a.created_at>=from_time and a.created_at<=to_time and (p_source is null or p_source='security')
      and a.payload->>'action' in ('login','logout','user_signedup','user_deleted','user_modified','user_updated_password',
        'user_invited','invite_accepted','user_recovery_requested','user_reauthenticate_requested',
        'user_confirmation_requested','user_repeated_signup','generate_recovery_codes','factor_in_progress',
        'factor_unenrolled','challenge_created','verification_attempted','factor_deleted','recovery_codes_deleted',
        'factor_updated','mfa_code_login','identity_unlinked')
    union all
    -- This is an observed FULL session, not a reconstruction of the Auth login timestamp.
    select 'session:'||c.id::text,c.id,c.created_at,'security','session.first_full_access','session','info','success',
      c.user_id,coalesce(nullif(p.full_name,''),nullif(p.username,'')),null::uuid,
      host(c.ip_address),null::text,c.session_id,null::uuid,null::text,
      jsonb_strip_nulls(jsonb_build_object('source','session_access','verification_scope','full_session',
        'user_agent',c.user_agent,'ip_source',c.ip_source,
        'details','نخستین درخواست ثبت‌شدهٔ این نشست پس از تأیید دسترسی کامل سامانه.')),
      null::jsonb,null::jsonb
    from private.event_session_context c left join public.profiles p on p.user_id=c.user_id
    where c.created_at>=from_time and c.created_at<=to_time and (p_source is null or p_source='security')

  ), filtered as (
    select * from combined c where (p_severity is null or c.severity=p_severity)
      and (p_result is null or c.result=p_result)
      and (search_text is null or strpos(lower(concat_ws(' ',c.event_type,c.category,c.actor_name,c.actor_user_id::text,
        c.target_user_id::text,c.request_id::text,c.session_id::text,c.ip_address,c.ip_hash,c.error_code,c.metadata::text)),lower(search_text))>0)
      and (p_before_time is null or (c.created_at,c.event_key)<(p_before_time,p_before_key))
    order by c.created_at desc,c.event_key desc limit p_limit+1
  ), page as (select * from filtered order by created_at desc,event_key desc limit p_limit)
  select coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,event_key desc) from page),'[]'::jsonb),
    (select count(*)>p_limit from filtered) into rows_json,more_rows;
  return jsonb_build_object('events',rows_json,'has_more',more_rows,
    'next_cursor',case when more_rows then jsonb_build_object('time',rows_json->-1->>'created_at','key',rows_json->-1->>'event_key') else null end);
end $$;
revoke all on function private.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer) from public,anon,authenticated;


NOTIFY pgrst, 'reload schema';
