create table if not exists public.conference_speaker_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  user_id uuid not null,
  granted_by uuid not null,
  starts_at timestamptz not null default now(),
  active_started_at timestamptz,
  expires_at timestamptz,
  allocated_seconds integer not null,
  used_seconds integer not null default 0,
  status text not null default 'ACTIVE',
  paused_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  enforcement_status text not null default 'PENDING',
  enforcement_requested_at timestamptz not null default now(),
  last_dispatched_at timestamptz,
  enforced_at timestamptz,
  enforcement_attempts integer not null default 0,
  last_enforcement_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conference_speaker_sessions_status_check
    check (status = any(array['QUEUED','ACTIVE','PAUSED','EXPIRED','CANCELLED','COMPLETED'])),
  constraint conference_speaker_sessions_allocated_seconds_check
    check (allocated_seconds between 10 and 7200),
  constraint conference_speaker_sessions_used_seconds_check
    check (used_seconds >= 0 and used_seconds <= allocated_seconds),
  constraint conference_speaker_sessions_enforcement_status_check
    check (enforcement_status = any(array['NONE','PENDING','DISPATCHED','DONE','FAILED']))
);
create unique index if not exists conference_speaker_sessions_one_open_idx
  on public.conference_speaker_sessions(room_id,user_id)
  where status in ('QUEUED','ACTIVE','PAUSED');
create index if not exists conference_speaker_sessions_room_created_idx
  on public.conference_speaker_sessions(room_id,created_at desc);
create index if not exists conference_speaker_sessions_expiry_idx
  on public.conference_speaker_sessions(expires_at)
  where status='ACTIVE';
create index if not exists conference_speaker_sessions_enforcement_idx
  on public.conference_speaker_sessions(enforcement_status,last_dispatched_at)
  where enforcement_status in ('PENDING','DISPATCHED','FAILED');

alter table public.conference_speaker_sessions enable row level security;
revoke all on table public.conference_speaker_sessions from public,anon;
grant select on table public.conference_speaker_sessions to authenticated,service_role;
grant insert,update,delete on table public.conference_speaker_sessions to service_role;

drop policy if exists "conference_speaker_sessions_select" on public.conference_speaker_sessions;
create policy "conference_speaker_sessions_select"
on public.conference_speaker_sessions
for select to authenticated
using (
  user_id=(select auth.uid())
  or private.has_conference_permission(room_id,'MANAGE_TIMER')
);

create table if not exists private.conference_speaker_timer_worker_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table private.conference_speaker_timer_worker_config enable row level security;
revoke all on table private.conference_speaker_timer_worker_config from public,anon,authenticated;

do $$
begin
  if not exists (
    select 1 from vault.secrets
    where name='conference_speaker_timer_worker_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'conference_speaker_timer_worker_secret',
      'Conference speaker timer cron worker authentication',
      null
    );
  end if;
end
$$;

create or replace function private.conference_livekit_policy_for_user(
  p_room_id uuid,p_user_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_role text;
  v_permissions text[];
  v_sources jsonb := '[]'::jsonb;
  v_allow_screen_share boolean := true;
  v_allow_reactions boolean := true;
  v_timer_enabled boolean := false;
  v_session_status text;
  v_session_expires_at timestamptz;
  v_can_publish_microphone boolean := false;
  v_can_publish boolean := false;
  v_can_subscribe boolean := false;
  v_can_publish_data boolean := false;
begin
  if p_user_id is null then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select coalesce(r.allow_screen_share,true),
         coalesce(r.allow_reactions,true),
         coalesce(r.speaking_limit_enabled,false)
  into v_allow_screen_share,v_allow_reactions,v_timer_enabled
  from public.conference_rooms r
  where r.id=p_room_id and r.status<>'ended';

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  v_role:=private.conference_effective_role(p_room_id,p_user_id);
  if v_role is null then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select coalesce(array_agg(rp.permission order by rp.permission),array[]::text[])
  into v_permissions
  from private.conference_role_permissions rp
  where rp.role=v_role;

  v_can_publish_microphone:='PUBLISH_MIC'=any(v_permissions);

  if v_timer_enabled and v_can_publish_microphone then
    select s.status,s.expires_at
    into v_session_status,v_session_expires_at
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id and s.user_id=p_user_id and s.status<>'CANCELLED'
    order by s.created_at desc
    limit 1;

    if v_session_status in ('PAUSED','EXPIRED','COMPLETED') then
      v_can_publish_microphone:=false;
    elsif v_session_status='ACTIVE'
          and v_session_expires_at is not null
          and v_session_expires_at<=clock_timestamp() then
      v_can_publish_microphone:=false;
    end if;
  end if;

  if 'PUBLISH_CAMERA'=any(v_permissions) then
    v_sources:=v_sources||jsonb_build_array('camera');
  end if;
  if v_can_publish_microphone then
    v_sources:=v_sources||jsonb_build_array('microphone');
  end if;
  if v_allow_screen_share and 'PUBLISH_SCREEN'=any(v_permissions) then
    v_sources:=v_sources||jsonb_build_array('screen_share','screen_share_audio');
  end if;

  v_can_publish:=jsonb_array_length(v_sources)>0;
  v_can_subscribe:='SUBSCRIBE_MEDIA'=any(v_permissions);
  v_can_publish_data:=v_allow_reactions and 'JOIN_ROOM'=any(v_permissions);

  return jsonb_build_object(
    'ok',true,'role',v_role,'permissions',to_jsonb(v_permissions),
    'can_publish',v_can_publish,'can_subscribe',v_can_subscribe,
    'can_publish_data',v_can_publish_data,'publish_sources',v_sources
  );
end;
$$;

create or replace function private.control_conference_speaker_timer(
  p_room_id uuid,p_target_user_id uuid,p_action text,p_seconds integer default null
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_session public.conference_speaker_sessions%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_elapsed integer:=0;
  v_remaining integer:=0;
begin
  if v_actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;
  if not private.has_conference_permission(p_room_id,'MANAGE_TIMER',v_actor) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  if not exists (
    select 1 from public.conference_rooms r
    where r.id=p_room_id and r.status<>'ended'
      and r.media_topology='sfu' and r.livekit_room_name is not null
  ) then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;
  if not exists (
    select 1 from public.conference_participants p
    where p.room_id=p_room_id and p.user_id=p_target_user_id and p.status='joined'
  ) then
    return jsonb_build_object('ok',false,'reason','participant_not_found');
  end if;

  if v_action='start' then
    if p_seconds is null or p_seconds<10 or p_seconds>3600 then
      return jsonb_build_object('ok',false,'reason','invalid_duration');
    end if;
    if not private.has_conference_permission(p_room_id,'PUBLISH_MIC',p_target_user_id) then
      return jsonb_build_object('ok',false,'reason','microphone_not_allowed');
    end if;

    update public.conference_speaker_sessions s
    set used_seconds=least(
          s.allocated_seconds,
          s.used_seconds+case
            when s.status='ACTIVE' and s.active_started_at is not null
              then greatest(0,floor(extract(epoch from (v_now-s.active_started_at)))::integer)
            else 0 end),
        status='CANCELLED',active_started_at=null,expires_at=null,
        ended_at=v_now,end_reason='superseded',enforcement_status='NONE',updated_at=v_now
    where s.room_id=p_room_id and s.user_id=p_target_user_id
      and s.status in ('QUEUED','ACTIVE','PAUSED');

    update public.conference_rooms
    set speaking_limit_enabled=true
    where id=p_room_id;

    insert into public.conference_speaker_sessions(
      room_id,user_id,granted_by,starts_at,active_started_at,expires_at,
      allocated_seconds,used_seconds,status,enforcement_status,enforcement_requested_at
    )
    values(
      p_room_id,p_target_user_id,v_actor,v_now,v_now,
      v_now+make_interval(secs=>p_seconds),p_seconds,0,'ACTIVE','PENDING',v_now
    )
    returning * into v_session;

    update public.conference_participants
    set speaking_limit_seconds=p_seconds
    where room_id=p_room_id and user_id=p_target_user_id;

    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,v_actor,p_target_user_id,'speaker_timer_started',
      jsonb_build_object('session_id',v_session.id,'allocated_seconds',p_seconds)
    );
  else
    select * into v_session
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id and s.user_id=p_target_user_id
      and s.status in ('ACTIVE','PAUSED')
    order by s.created_at desc limit 1 for update;

    if not found then
      return jsonb_build_object('ok',false,'reason','session_not_active');
    end if;

    if v_action='extend' then
      if p_seconds is null or p_seconds<1 or p_seconds>3600
         or v_session.allocated_seconds+p_seconds>7200 then
        return jsonb_build_object('ok',false,'reason','invalid_extension');
      end if;
      update public.conference_speaker_sessions
      set allocated_seconds=allocated_seconds+p_seconds,
          expires_at=case when status='ACTIVE' and expires_at is not null
                          then expires_at+make_interval(secs=>p_seconds)
                          else expires_at end,
          updated_at=v_now
      where id=v_session.id
      returning * into v_session;

      insert into public.conference_audit_events(
        room_id,actor_user_id,target_user_id,event_type,metadata
      )
      values(
        p_room_id,v_actor,p_target_user_id,'speaker_timer_extended',
        jsonb_build_object('session_id',v_session.id,'added_seconds',p_seconds)
      );
    elsif v_action='pause' then
      if v_session.status<>'ACTIVE' then
        return jsonb_build_object('ok',false,'reason','session_not_active');
      end if;
      v_elapsed:=greatest(0,floor(extract(epoch from (v_now-v_session.active_started_at)))::integer);
      update public.conference_speaker_sessions
      set used_seconds=least(allocated_seconds,used_seconds+v_elapsed),
          status='PAUSED',active_started_at=null,expires_at=null,paused_at=v_now,
          enforcement_status='PENDING',enforcement_requested_at=v_now,enforced_at=null,
          last_enforcement_error=null,updated_at=v_now
      where id=v_session.id
      returning * into v_session;

      insert into public.conference_audit_events(
        room_id,actor_user_id,target_user_id,event_type,metadata
      )
      values(
        p_room_id,v_actor,p_target_user_id,'speaker_timer_paused',
        jsonb_build_object('session_id',v_session.id)
      );
    elsif v_action='resume' then
      if v_session.status<>'PAUSED' then
        return jsonb_build_object('ok',false,'reason','session_not_paused');
      end if;
      v_remaining:=greatest(0,v_session.allocated_seconds-v_session.used_seconds);
      if v_remaining<=0 then
        return jsonb_build_object('ok',false,'reason','session_expired');
      end if;

      update public.conference_speaker_sessions
      set status='ACTIVE',active_started_at=v_now,
          expires_at=v_now+make_interval(secs=>v_remaining),paused_at=null,
          enforcement_status='PENDING',enforcement_requested_at=v_now,enforced_at=null,
          last_enforcement_error=null,updated_at=v_now
      where id=v_session.id
      returning * into v_session;

      insert into public.conference_audit_events(
        room_id,actor_user_id,target_user_id,event_type,metadata
      )
      values(
        p_room_id,v_actor,p_target_user_id,'speaker_timer_resumed',
        jsonb_build_object('session_id',v_session.id)
      );
    elsif v_action='stop' then
      if v_session.status='ACTIVE' and v_session.active_started_at is not null then
        v_elapsed:=greatest(0,floor(extract(epoch from (v_now-v_session.active_started_at)))::integer);
      end if;
      update public.conference_speaker_sessions
      set used_seconds=least(allocated_seconds,used_seconds+v_elapsed),
          status='COMPLETED',active_started_at=null,expires_at=null,ended_at=v_now,
          end_reason='stopped_by_manager',enforcement_status='PENDING',
          enforcement_requested_at=v_now,enforced_at=null,last_enforcement_error=null,
          updated_at=v_now
      where id=v_session.id
      returning * into v_session;

      insert into public.conference_audit_events(
        room_id,actor_user_id,target_user_id,event_type,metadata
      )
      values(
        p_room_id,v_actor,p_target_user_id,'speaker_timer_stopped',
        jsonb_build_object('session_id',v_session.id)
      );
    else
      return jsonb_build_object('ok',false,'reason','unknown_action');
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,'server_time',v_now,'session',to_jsonb(v_session),
    'livekit_policy',private.conference_livekit_policy_for_user(p_room_id,p_target_user_id)
  );
end;
$$;

create or replace function public.control_conference_speaker_timer(
  p_room_id uuid,p_target_user_id uuid,p_action text,p_seconds integer default null
)
returns jsonb language sql security invoker set search_path=''
as $$ select private.control_conference_speaker_timer(p_room_id,p_target_user_id,p_action,p_seconds) $$;

revoke execute on function private.control_conference_speaker_timer(uuid,uuid,text,integer) from public,anon;
grant execute on function private.control_conference_speaker_timer(uuid,uuid,text,integer) to authenticated,service_role;
revoke execute on function public.control_conference_speaker_timer(uuid,uuid,text,integer) from public,anon;
grant execute on function public.control_conference_speaker_timer(uuid,uuid,text,integer) to authenticated,service_role;

create or replace function private.get_conference_speaker_timer_snapshot(p_room_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_can_manage boolean:=false;
  v_sessions jsonb;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated','server_time',clock_timestamp(),'sessions','[]'::jsonb);
  end if;
  if not exists (
    select 1 from public.conference_rooms r
    where r.id=p_room_id
      and (r.host_id=v_uid or exists(
        select 1 from public.conference_participants p
        where p.room_id=p_room_id and p.user_id=v_uid
      ))
  ) then
    return jsonb_build_object('ok',false,'reason','not_authorized','server_time',clock_timestamp(),'sessions','[]'::jsonb);
  end if;

  v_can_manage:=private.has_conference_permission(p_room_id,'MANAGE_TIMER',v_uid);

  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb)
  into v_sessions
  from (
    select distinct on (s.user_id)
      s.id,s.room_id,s.user_id,s.granted_by,s.starts_at,s.active_started_at,
      s.expires_at,s.allocated_seconds,s.used_seconds,s.status,s.paused_at,
      s.ended_at,s.end_reason,s.created_at,s.updated_at
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id and s.status<>'CANCELLED'
      and (v_can_manage or s.user_id=v_uid)
    order by s.user_id,s.created_at desc
  ) q;

  return jsonb_build_object(
    'ok',true,'server_time',clock_timestamp(),
    'can_manage',v_can_manage,'sessions',v_sessions
  );
end;
$$;

create or replace function public.get_conference_speaker_timer_snapshot(p_room_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$ select private.get_conference_speaker_timer_snapshot(p_room_id) $$;

revoke execute on function private.get_conference_speaker_timer_snapshot(uuid) from public,anon;
grant execute on function private.get_conference_speaker_timer_snapshot(uuid) to authenticated,service_role;
revoke execute on function public.get_conference_speaker_timer_snapshot(uuid) from public,anon;
grant execute on function public.get_conference_speaker_timer_snapshot(uuid) to authenticated,service_role;

create or replace function private.configure_conference_speaker_timer_worker(p_url text)
returns void
language plpgsql security definer set search_path=''
as $$
begin
  if nullif(trim(p_url),'') is null or p_url !~ '^https?://' then
    raise exception 'invalid worker url';
  end if;
  insert into private.conference_speaker_timer_worker_config(key,value,updated_at)
  values('worker_url',trim(p_url),now())
  on conflict(key) do update set value=excluded.value,updated_at=now();
end;
$$;
revoke execute on function private.configure_conference_speaker_timer_worker(text) from public,anon,authenticated;
grant execute on function private.configure_conference_speaker_timer_worker(text) to service_role;

create or replace function private.verify_conference_speaker_timer_worker_secret(p_secret text)
returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from vault.decrypted_secrets s
    where s.name='conference_speaker_timer_worker_secret'
      and s.decrypted_secret=p_secret
  )
$$;
revoke execute on function private.verify_conference_speaker_timer_worker_secret(text) from public,anon,authenticated;
grant execute on function private.verify_conference_speaker_timer_worker_secret(text) to service_role;

create or replace function public.verify_conference_speaker_timer_worker_secret(p_secret text)
returns boolean language sql security invoker set search_path=''
as $$ select private.verify_conference_speaker_timer_worker_secret(p_secret) $$;
revoke execute on function public.verify_conference_speaker_timer_worker_secret(text) from public,anon,authenticated;
grant execute on function public.verify_conference_speaker_timer_worker_secret(text) to service_role;

create or replace function private.claim_conference_speaker_enforcement(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_session public.conference_speaker_sessions%rowtype;
  v_room_name text;
begin
  select * into v_session
  from public.conference_speaker_sessions s
  where s.id=p_session_id for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','session_not_found');
  end if;
  if v_session.enforcement_status='DONE' then
    return jsonb_build_object('ok',true,'already_done',true);
  end if;

  select r.livekit_room_name into v_room_name
  from public.conference_rooms r
  where r.id=v_session.room_id and r.media_topology='sfu';

  if v_room_name is null then
    return jsonb_build_object('ok',false,'reason','livekit_room_missing');
  end if;

  return jsonb_build_object(
    'ok',true,'already_done',false,'session_id',v_session.id,
    'room_id',v_session.room_id,'user_id',v_session.user_id,
    'status',v_session.status,'livekit_room_name',v_room_name,
    'livekit_policy',private.conference_livekit_policy_for_user(v_session.room_id,v_session.user_id)
  );
end;
$$;

create or replace function public.claim_conference_speaker_enforcement(p_session_id uuid)
returns jsonb language sql security invoker set search_path=''
as $$ select private.claim_conference_speaker_enforcement(p_session_id) $$;

revoke execute on function private.claim_conference_speaker_enforcement(uuid) from public,anon,authenticated;
grant execute on function private.claim_conference_speaker_enforcement(uuid) to service_role;
revoke execute on function public.claim_conference_speaker_enforcement(uuid) from public,anon,authenticated;
grant execute on function public.claim_conference_speaker_enforcement(uuid) to service_role;

create or replace function private.complete_conference_speaker_enforcement(
  p_session_id uuid,p_success boolean,p_error text default null,p_runtime_updated boolean default false
)
returns void
language plpgsql security definer set search_path=''
as $$
declare
  v_session public.conference_speaker_sessions%rowtype;
begin
  update public.conference_speaker_sessions
  set enforcement_status=case when p_success then 'DONE' else 'FAILED' end,
      enforced_at=case when p_success then clock_timestamp() else enforced_at end,
      last_enforcement_error=case when p_success then null else left(coalesce(p_error,'unknown'),500) end,
      updated_at=clock_timestamp()
  where id=p_session_id
  returning * into v_session;

  if found then
    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      v_session.room_id,null,v_session.user_id,
      case when p_success then 'speaker_timer_enforced' else 'speaker_timer_enforcement_failed' end,
      jsonb_build_object(
        'session_id',v_session.id,'status',v_session.status,
        'runtime_updated',p_runtime_updated,
        'error',case when p_success then null else left(coalesce(p_error,'unknown'),500) end
      )
    );
  end if;
end;
$$;

create or replace function public.complete_conference_speaker_enforcement(
  p_session_id uuid,p_success boolean,p_error text default null,p_runtime_updated boolean default false
)
returns void language sql security invoker set search_path=''
as $$ select private.complete_conference_speaker_enforcement(p_session_id,p_success,p_error,p_runtime_updated) $$;

revoke execute on function private.complete_conference_speaker_enforcement(uuid,boolean,text,boolean) from public,anon,authenticated;
grant execute on function private.complete_conference_speaker_enforcement(uuid,boolean,text,boolean) to service_role;
revoke execute on function public.complete_conference_speaker_enforcement(uuid,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.complete_conference_speaker_enforcement(uuid,boolean,text,boolean) to service_role;

create or replace function private.expire_conference_speaker_sessions()
returns integer
language plpgsql security definer set search_path=''
as $$
declare v_count integer:=0;
begin
  with expired as (
    update public.conference_speaker_sessions s
    set used_seconds=s.allocated_seconds,status='EXPIRED',
        active_started_at=null,ended_at=clock_timestamp(),end_reason='time_expired',
        enforcement_status='PENDING',enforcement_requested_at=clock_timestamp(),
        enforced_at=null,last_enforcement_error=null,updated_at=clock_timestamp()
    where s.status='ACTIVE' and s.expires_at is not null
      and s.expires_at<=clock_timestamp()
    returning s.id,s.room_id,s.user_id,s.allocated_seconds
  ),
  audited as (
    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    select e.room_id,null,e.user_id,'speaker_timer_expired',
           jsonb_build_object('session_id',e.id,'allocated_seconds',e.allocated_seconds)
    from expired e
    returning 1
  )
  select count(*)::integer into v_count from audited;
  return v_count;
end;
$$;
revoke execute on function private.expire_conference_speaker_sessions() from public,anon,authenticated;
grant execute on function private.expire_conference_speaker_sessions() to service_role;

create or replace function private.dispatch_conference_speaker_timer_enforcement()
returns integer
language plpgsql security definer set search_path=''
as $$
declare
  v_url text;
  v_secret text;
  v_row record;
  v_count integer:=0;
begin
  perform private.expire_conference_speaker_sessions();

  select c.value into v_url
  from private.conference_speaker_timer_worker_config c
  where c.key='worker_url';

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name='conference_speaker_timer_worker_secret';

  if nullif(v_url,'') is null or nullif(v_secret,'') is null then
    return 0;
  end if;

  for v_row in
    select s.id
    from public.conference_speaker_sessions s
    where s.enforcement_status in ('PENDING','FAILED')
       or (s.enforcement_status='DISPATCHED'
           and s.last_dispatched_at<clock_timestamp()-interval '15 seconds')
    order by s.enforcement_requested_at
    limit 20
    for update skip locked
  loop
    begin
      update public.conference_speaker_sessions
      set enforcement_status='DISPATCHED',last_dispatched_at=clock_timestamp(),
          enforcement_attempts=enforcement_attempts+1,updated_at=clock_timestamp()
      where id=v_row.id;

      perform net.http_post(
        url:=v_url,
        headers:=jsonb_build_object(
          'Content-Type','application/json',
          'X-Speaker-Timer-Secret',v_secret
        ),
        body:=jsonb_build_object('sessionId',v_row.id),
        timeout_milliseconds:=5000
      );
      v_count:=v_count+1;
    exception when others then
      update public.conference_speaker_sessions
      set enforcement_status='FAILED',
          last_enforcement_error=left(sqlerrm,500),
          updated_at=clock_timestamp()
      where id=v_row.id;
    end;
  end loop;

  return v_count;
end;
$$;
revoke execute on function private.dispatch_conference_speaker_timer_enforcement() from public,anon,authenticated;
grant execute on function private.dispatch_conference_speaker_timer_enforcement() to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_speaker_sessions'
  ) then
    alter publication supabase_realtime add table public.conference_speaker_sessions;
  end if;
end
$$;

select cron.schedule(
  'conference-speaker-timer-enforcer',
  '5 seconds',
  'select private.dispatch_conference_speaker_timer_enforcement();'
);

notify pgrst,'reload schema';
