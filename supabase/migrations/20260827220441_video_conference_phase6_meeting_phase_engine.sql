insert into private.conference_permissions(permission)
values('MANAGE_PHASE')
on conflict(permission) do nothing;

insert into private.conference_role_permissions(role,permission)
values
  ('OWNER','MANAGE_PHASE'),
  ('HOST','MANAGE_PHASE'),
  ('CO_HOST','MANAGE_PHASE')
on conflict(role,permission) do nothing;

alter table public.conference_rooms
  add column if not exists current_phase text not null default 'WAITING',
  add column if not exists phase_started_at timestamptz,
  add column if not exists phase_ends_at timestamptz,
  add column if not exists phase_revision bigint not null default 0,
  add column if not exists phase_allow_mic boolean not null default true,
  add column if not exists phase_allow_camera boolean not null default true,
  add column if not exists phase_allow_chat boolean not null default true;

alter table public.conference_rooms
  drop constraint if exists conference_rooms_current_phase_check;

alter table public.conference_rooms
  add constraint conference_rooms_current_phase_check
  check (
    current_phase = any(array[
      'SCHEDULED','WAITING','COUNTDOWN','LIVE','BREAK','RESUMING','ENDED'
    ])
  );

update public.conference_rooms
set current_phase=case status
      when 'ended' then 'ENDED'
      when 'active' then 'LIVE'
      else 'WAITING'
    end,
    phase_started_at=coalesce(
      case when status='ended' then ended_at else null end,
      created_at,
      clock_timestamp()
    ),
    phase_ends_at=null,
    phase_allow_mic=true,
    phase_allow_camera=true,
    phase_allow_chat=true
where phase_revision=0;

update public.conference_rooms
set phase_started_at=coalesce(phase_started_at,created_at,clock_timestamp())
where phase_started_at is null;

alter table public.conference_rooms
  alter column phase_started_at set not null,
  alter column phase_started_at set default now();

create table if not exists public.conference_phase_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  revision bigint not null,
  from_phase text,
  to_phase text not null,
  actor_user_id uuid,
  reason text not null,
  duration_seconds integer,
  phase_started_at timestamptz not null,
  phase_ends_at timestamptz,
  allow_mic boolean not null,
  allow_camera boolean not null,
  allow_chat boolean not null,
  runtime_sync_status text not null default 'PENDING',
  last_dispatched_at timestamptz,
  enforcement_attempts integer not null default 0,
  enforced_at timestamptz,
  last_enforcement_error text,
  participants_updated integer not null default 0,
  participants_offline integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conference_phase_events_phase_check
    check (
      (from_phase is null or from_phase = any(array[
        'SCHEDULED','WAITING','COUNTDOWN','LIVE','BREAK','RESUMING','ENDED'
      ]))
      and to_phase = any(array[
        'SCHEDULED','WAITING','COUNTDOWN','LIVE','BREAK','RESUMING','ENDED'
      ])
    ),
  constraint conference_phase_events_duration_check
    check (duration_seconds is null or duration_seconds between 1 and 7200),
  constraint conference_phase_events_runtime_sync_check
    check (runtime_sync_status = any(array[
      'PENDING','DISPATCHED','DONE','FAILED','SUPERSEDED'
    ])),
  constraint conference_phase_events_counts_check
    check (
      enforcement_attempts>=0
      and participants_updated>=0
      and participants_offline>=0
    ),
  constraint conference_phase_events_room_revision_key
    unique(room_id,revision)
);

create index if not exists conference_phase_events_runtime_idx
  on public.conference_phase_events(runtime_sync_status,last_dispatched_at)
  where runtime_sync_status in ('PENDING','DISPATCHED','FAILED');

create index if not exists conference_phase_events_room_revision_idx
  on public.conference_phase_events(room_id,revision desc);

alter table public.conference_phase_events enable row level security;
revoke all on table public.conference_phase_events from public,anon;
grant select on table public.conference_phase_events to authenticated,service_role;
grant insert,update,delete on table public.conference_phase_events to service_role;

drop policy if exists "conference_phase_events_select" on public.conference_phase_events;
create policy "conference_phase_events_select"
on public.conference_phase_events
for select to authenticated
using (
  private.is_conference_joined_actor_in_room(room_id)
  or private.has_conference_permission(room_id,'MANAGE_PHASE')
);

create table if not exists private.conference_phase_worker_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table private.conference_phase_worker_config enable row level security;
revoke all on table private.conference_phase_worker_config from public,anon,authenticated;

do $$
begin
  if not exists (
    select 1 from vault.secrets
    where name='conference_phase_worker_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'conference_phase_worker_secret',
      'Conference meeting phase cron worker authentication',
      null
    );
  end if;
end
$$;

create or replace function private.conference_phase_transition_allowed(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
set search_path=''
as $$
  select case
    when p_from='SCHEDULED' and p_to='WAITING' then true
    when p_from='WAITING' and p_to='COUNTDOWN' then true
    when p_from='COUNTDOWN' and p_to='LIVE' then true
    when p_from='LIVE' and p_to='BREAK' then true
    when p_from='BREAK' and p_to='RESUMING' then true
    when p_from='RESUMING' and p_to='LIVE' then true
    when p_from<>'ENDED' and p_to='ENDED' then true
    else false
  end
$$;

revoke execute on function private.conference_phase_transition_allowed(text,text)
from public,anon;
grant execute on function private.conference_phase_transition_allowed(text,text)
to authenticated,service_role;

create or replace function private.transition_conference_phase(
  p_room_id uuid,
  p_to_phase text,
  p_duration_seconds integer,
  p_actor_user_id uuid,
  p_reason text,
  p_allow_mic boolean default true,
  p_allow_camera boolean default true,
  p_allow_chat boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.conference_rooms%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_to text:=upper(trim(coalesce(p_to_phase,'')));
  v_revision bigint;
  v_event public.conference_phase_events%rowtype;
  v_ends_at timestamptz;
  v_allow_mic boolean:=coalesce(p_allow_mic,true);
  v_allow_camera boolean:=coalesce(p_allow_camera,true);
  v_allow_chat boolean:=coalesce(p_allow_chat,true);
begin
  select * into v_room
  from public.conference_rooms r
  where r.id=p_room_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if not private.conference_phase_transition_allowed(
    v_room.current_phase,v_to
  ) then
    return jsonb_build_object(
      'ok',false,'reason','invalid_transition',
      'from_phase',v_room.current_phase,'to_phase',v_to
    );
  end if;

  if v_to='COUNTDOWN' then
    if p_duration_seconds is null
       or p_duration_seconds<10
       or p_duration_seconds>3600 then
      return jsonb_build_object('ok',false,'reason','invalid_duration');
    end if;
    v_ends_at:=v_now+make_interval(secs=>p_duration_seconds);
    v_allow_mic:=false;
    v_allow_camera:=false;
    v_allow_chat:=true;
  elsif v_to='BREAK' then
    if p_duration_seconds is null
       or p_duration_seconds<10
       or p_duration_seconds>7200 then
      return jsonb_build_object('ok',false,'reason','invalid_duration');
    end if;
    v_ends_at:=v_now+make_interval(secs=>p_duration_seconds);
  elsif v_to='RESUMING' then
    v_ends_at:=v_now+interval '1 second';
    v_allow_mic:=false;
    v_allow_camera:=false;
    v_allow_chat:=true;
  elsif v_to='LIVE' then
    v_ends_at:=null;
    v_allow_mic:=true;
    v_allow_camera:=true;
    v_allow_chat:=true;
  elsif v_to='WAITING' then
    v_ends_at:=null;
    v_allow_mic:=true;
    v_allow_camera:=true;
    v_allow_chat:=true;
  elsif v_to='ENDED' then
    v_ends_at:=null;
    v_allow_mic:=false;
    v_allow_camera:=false;
    v_allow_chat:=false;
  else
    return jsonb_build_object('ok',false,'reason','unsupported_target_phase');
  end if;

  v_revision:=v_room.phase_revision+1;

  update public.conference_rooms
  set current_phase=v_to,
      phase_started_at=v_now,
      phase_ends_at=v_ends_at,
      phase_revision=v_revision,
      phase_allow_mic=v_allow_mic,
      phase_allow_camera=v_allow_camera,
      phase_allow_chat=v_allow_chat,
      status=case when v_to='ENDED' then 'ended' else 'active' end,
      ended_at=case when v_to='ENDED' then coalesce(ended_at,v_now) else ended_at end,
      ended_reason=case
        when v_to='ENDED'
          then coalesce(nullif(trim(p_reason),''),'ended_by_host')
        else ended_reason
      end
  where id=p_room_id;

  insert into public.conference_phase_events(
    room_id,revision,from_phase,to_phase,actor_user_id,reason,
    duration_seconds,phase_started_at,phase_ends_at,
    allow_mic,allow_camera,allow_chat,
    runtime_sync_status
  )
  values(
    p_room_id,v_revision,v_room.current_phase,v_to,p_actor_user_id,
    coalesce(nullif(trim(p_reason),''),'phase_transition'),
    case when v_to in ('COUNTDOWN','BREAK','RESUMING')
      then greatest(1,coalesce(p_duration_seconds,1))
      else null
    end,
    v_now,v_ends_at,
    v_allow_mic,v_allow_camera,v_allow_chat,
    'PENDING'
  )
  returning * into v_event;

  insert into public.conference_audit_events(
    room_id,actor_user_id,event_type,metadata
  )
  values(
    p_room_id,p_actor_user_id,'conference_phase_transition',
    jsonb_build_object(
      'event_id',v_event.id,
      'revision',v_revision,
      'from_phase',v_room.current_phase,
      'to_phase',v_to,
      'duration_seconds',v_event.duration_seconds,
      'allow_mic',v_allow_mic,
      'allow_camera',v_allow_camera,
      'allow_chat',v_allow_chat,
      'reason',v_event.reason
    )
  );

  return jsonb_build_object(
    'ok',true,
    'server_time',v_now,
    'event_id',v_event.id,
    'revision',v_revision,
    'from_phase',v_room.current_phase,
    'current_phase',v_to,
    'phase_started_at',v_now,
    'phase_ends_at',v_ends_at,
    'allow_mic',v_allow_mic,
    'allow_camera',v_allow_camera,
    'allow_chat',v_allow_chat
  );
end;
$$;

revoke execute on function private.transition_conference_phase(
  uuid,text,integer,uuid,text,boolean,boolean,boolean
) from public,anon,authenticated;
grant execute on function private.transition_conference_phase(
  uuid,text,integer,uuid,text,boolean,boolean,boolean
) to service_role;

create or replace function private.get_conference_phase_snapshot(
  p_room_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_room public.conference_rooms%rowtype;
  v_can_manage boolean:=false;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'reason','not_authenticated','server_time',clock_timestamp()
    );
  end if;

  select * into v_room
  from public.conference_rooms r
  where r.id=p_room_id
    and (
      r.host_id=v_uid
      or exists(
        select 1
        from public.conference_participants p
        where p.room_id=p_room_id and p.user_id=v_uid
      )
    );

  if not found then
    return jsonb_build_object(
      'ok',false,'reason','not_authorized','server_time',clock_timestamp()
    );
  end if;

  v_can_manage:=private.has_conference_permission(
    p_room_id,'MANAGE_PHASE',v_uid
  );

  return jsonb_build_object(
    'ok',true,
    'server_time',clock_timestamp(),
    'current_phase',v_room.current_phase,
    'phase_started_at',v_room.phase_started_at,
    'phase_ends_at',v_room.phase_ends_at,
    'revision',v_room.phase_revision,
    'allow_mic',v_room.phase_allow_mic,
    'allow_camera',v_room.phase_allow_camera,
    'allow_chat',v_room.phase_allow_chat,
    'can_manage',v_can_manage
  );
end;
$$;

create or replace function public.get_conference_phase_snapshot(
  p_room_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select private.get_conference_phase_snapshot(p_room_id)
$$;

revoke execute on function private.get_conference_phase_snapshot(uuid)
from public,anon;
grant execute on function private.get_conference_phase_snapshot(uuid)
to authenticated,service_role;
revoke execute on function public.get_conference_phase_snapshot(uuid)
from public,anon;
grant execute on function public.get_conference_phase_snapshot(uuid)
to authenticated,service_role;

create or replace function private.authorize_conference_phase_action(
  p_room_id uuid,
  p_action text,
  p_duration_seconds integer default null,
  p_allow_mic boolean default null,
  p_allow_camera boolean default null,
  p_allow_chat boolean default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_phase text;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  if not private.has_conference_permission(
    p_room_id,'MANAGE_PHASE',v_uid
  ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  select r.current_phase into v_phase
  from public.conference_rooms r
  where r.id=p_room_id
    and r.status<>'ended'
    and r.media_topology='sfu'
    and r.livekit_room_name is not null;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if v_action='open_waiting' then
    if v_phase<>'SCHEDULED' then
      return jsonb_build_object('ok',false,'reason','invalid_transition');
    end if;
  elsif v_action='start_countdown' then
    if v_phase<>'WAITING' then
      return jsonb_build_object('ok',false,'reason','invalid_transition');
    end if;
    if p_duration_seconds is null
       or p_duration_seconds<10
       or p_duration_seconds>3600 then
      return jsonb_build_object('ok',false,'reason','invalid_duration');
    end if;
  elsif v_action='start_break' then
    if v_phase<>'LIVE' then
      return jsonb_build_object('ok',false,'reason','invalid_transition');
    end if;
    if p_duration_seconds is null
       or p_duration_seconds<10
       or p_duration_seconds>7200 then
      return jsonb_build_object('ok',false,'reason','invalid_duration');
    end if;
  elsif v_action='resume' then
    if v_phase<>'BREAK' then
      return jsonb_build_object('ok',false,'reason','invalid_transition');
    end if;
  else
    return jsonb_build_object('ok',false,'reason','unknown_action');
  end if;

  return jsonb_build_object(
    'ok',true,'actor_user_id',v_uid,'action',v_action,
    'current_phase',v_phase
  );
end;
$$;

create or replace function public.authorize_conference_phase_action(
  p_room_id uuid,
  p_action text,
  p_duration_seconds integer default null,
  p_allow_mic boolean default null,
  p_allow_camera boolean default null,
  p_allow_chat boolean default null
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select private.authorize_conference_phase_action(
    p_room_id,p_action,p_duration_seconds,
    p_allow_mic,p_allow_camera,p_allow_chat
  )
$$;

revoke execute on function private.authorize_conference_phase_action(
  uuid,text,integer,boolean,boolean,boolean
) from public,anon;
grant execute on function private.authorize_conference_phase_action(
  uuid,text,integer,boolean,boolean,boolean
) to authenticated,service_role;
revoke execute on function public.authorize_conference_phase_action(
  uuid,text,integer,boolean,boolean,boolean
) from public,anon;
grant execute on function public.authorize_conference_phase_action(
  uuid,text,integer,boolean,boolean,boolean
) to authenticated,service_role;

create or replace function private.apply_conference_phase_action(
  p_room_id uuid,
  p_action text,
  p_duration_seconds integer,
  p_allow_mic boolean,
  p_allow_camera boolean,
  p_allow_chat boolean,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
begin
  if p_actor_user_id is null
     or not private.has_conference_permission(
       p_room_id,'MANAGE_PHASE',p_actor_user_id
     ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if v_action='open_waiting' then
    return private.transition_conference_phase(
      p_room_id,'WAITING',null,p_actor_user_id,
      'opened_waiting',true,true,true
    );
  elsif v_action='start_countdown' then
    return private.transition_conference_phase(
      p_room_id,'COUNTDOWN',p_duration_seconds,p_actor_user_id,
      'countdown_started',false,false,true
    );
  elsif v_action='start_break' then
    return private.transition_conference_phase(
      p_room_id,'BREAK',p_duration_seconds,p_actor_user_id,
      'break_started',
      coalesce(p_allow_mic,false),
      coalesce(p_allow_camera,false),
      coalesce(p_allow_chat,true)
    );
  elsif v_action='resume' then
    return private.transition_conference_phase(
      p_room_id,'RESUMING',1,p_actor_user_id,
      'break_resuming',false,false,true
    );
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

create or replace function public.apply_livekit_conference_phase_action(
  p_room_id uuid,
  p_action text,
  p_duration_seconds integer,
  p_allow_mic boolean,
  p_allow_camera boolean,
  p_allow_chat boolean,
  p_actor_user_id uuid
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.apply_conference_phase_action(
    p_room_id,p_action,p_duration_seconds,
    p_allow_mic,p_allow_camera,p_allow_chat,p_actor_user_id
  )
$$;

revoke execute on function private.apply_conference_phase_action(
  uuid,text,integer,boolean,boolean,boolean,uuid
) from public,anon,authenticated;
grant execute on function private.apply_conference_phase_action(
  uuid,text,integer,boolean,boolean,boolean,uuid
) to service_role;
revoke execute on function public.apply_livekit_conference_phase_action(
  uuid,text,integer,boolean,boolean,boolean,uuid
) from public,anon,authenticated;
grant execute on function public.apply_livekit_conference_phase_action(
  uuid,text,integer,boolean,boolean,boolean,uuid
) to service_role;

create or replace function private.conference_livekit_policy_for_user(
  p_room_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_permissions text[];
  v_sources jsonb := '[]'::jsonb;
  v_allow_screen_share boolean := true;
  v_allow_reactions boolean := true;
  v_timer_enabled boolean := false;
  v_current_phase text := 'LIVE';
  v_phase_allow_mic boolean := true;
  v_phase_allow_camera boolean := true;
  v_session_status text;
  v_session_expires_at timestamptz;
  v_can_publish_microphone boolean := false;
  v_can_publish_camera boolean := false;
  v_can_publish boolean := false;
  v_can_subscribe boolean := false;
  v_can_publish_data boolean := false;
begin
  if p_user_id is null then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select
    coalesce(r.allow_screen_share,true),
    coalesce(r.allow_reactions,true),
    coalesce(r.speaking_limit_enabled,false),
    coalesce(r.current_phase,'LIVE'),
    coalesce(r.phase_allow_mic,true),
    coalesce(r.phase_allow_camera,true)
  into
    v_allow_screen_share,
    v_allow_reactions,
    v_timer_enabled,
    v_current_phase,
    v_phase_allow_mic,
    v_phase_allow_camera
  from public.conference_rooms r
  where r.id=p_room_id and r.status<>'ended';

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  v_role:=private.conference_effective_role(p_room_id,p_user_id);
  if v_role is null then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select coalesce(
    array_agg(rp.permission order by rp.permission),
    array[]::text[]
  )
  into v_permissions
  from private.conference_role_permissions rp
  where rp.role=v_role;

  v_can_publish_microphone:='PUBLISH_MIC'=any(v_permissions);
  v_can_publish_camera:='PUBLISH_CAMERA'=any(v_permissions);

  if v_current_phase in ('COUNTDOWN','RESUMING') then
    v_can_publish_microphone:=false;
    v_can_publish_camera:=false;
  elsif v_current_phase='BREAK' then
    v_can_publish_microphone:=v_can_publish_microphone and v_phase_allow_mic;
    v_can_publish_camera:=v_can_publish_camera and v_phase_allow_camera;
  end if;

  if v_timer_enabled and v_can_publish_microphone then
    select s.status,s.expires_at
    into v_session_status,v_session_expires_at
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id
      and s.user_id=p_user_id
      and s.status<>'CANCELLED'
    order by s.created_at desc
    limit 1;

    if v_session_status in ('QUEUED','PAUSED','EXPIRED','COMPLETED') then
      v_can_publish_microphone:=false;
    elsif v_session_status='ACTIVE'
          and v_session_expires_at is not null
          and v_session_expires_at<=clock_timestamp() then
      v_can_publish_microphone:=false;
    end if;
  end if;

  if v_can_publish_camera then
    v_sources:=v_sources||jsonb_build_array('camera');
  end if;
  if v_can_publish_microphone then
    v_sources:=v_sources||jsonb_build_array('microphone');
  end if;
  if v_allow_screen_share and 'PUBLISH_SCREEN'=any(v_permissions) then
    v_sources:=v_sources||jsonb_build_array(
      'screen_share','screen_share_audio'
    );
  end if;

  v_can_publish:=jsonb_array_length(v_sources)>0;
  v_can_subscribe:='SUBSCRIBE_MEDIA'=any(v_permissions);
  v_can_publish_data:=v_allow_reactions and 'JOIN_ROOM'=any(v_permissions);

  return jsonb_build_object(
    'ok',true,
    'role',v_role,
    'permissions',to_jsonb(v_permissions),
    'current_phase',v_current_phase,
    'can_publish',v_can_publish,
    'can_subscribe',v_can_subscribe,
    'can_publish_data',v_can_publish_data,
    'publish_sources',v_sources
  );
end;
$$;

drop policy if exists "Authenticated users can send messages"
on public.conference_messages;

create policy "Authenticated users can send messages"
on public.conference_messages
for insert to authenticated
with check (
  (select auth.uid())=user_id
  and private.is_conference_joined_actor_in_room(room_id)
  and private.has_conference_permission(room_id,'SEND_CHAT')
  and exists(
    select 1
    from public.conference_rooms r
    where r.id=conference_messages.room_id
      and r.chat_enabled=true
      and r.phase_allow_chat=true
      and r.status<>'ended'
  )
);

create or replace function private.claim_conference_phase_enforcement(
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.conference_phase_events%rowtype;
  v_room public.conference_rooms%rowtype;
  v_policies jsonb;
begin
  select * into v_event
  from public.conference_phase_events e
  where e.id=p_event_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','event_not_found');
  end if;

  if v_event.runtime_sync_status in ('DONE','SUPERSEDED') then
    return jsonb_build_object('ok',true,'already_done',true);
  end if;

  select * into v_room
  from public.conference_rooms r
  where r.id=v_event.room_id;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if v_event.revision<>v_room.phase_revision
     or v_event.to_phase<>v_room.current_phase then
    update public.conference_phase_events
    set runtime_sync_status='SUPERSEDED',
        updated_at=clock_timestamp(),
        last_enforcement_error=null
    where id=v_event.id;

    return jsonb_build_object(
      'ok',true,'already_done',true,'superseded',true
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id',p.user_id,
        'livekit_policy',
          private.conference_livekit_policy_for_user(
            v_room.id,p.user_id
          )
      )
      order by p.joined_at,p.user_id
    ),
    '[]'::jsonb
  )
  into v_policies
  from public.conference_participants p
  where p.room_id=v_room.id and p.status='joined';

  return jsonb_build_object(
    'ok',true,
    'already_done',false,
    'event_id',v_event.id,
    'room_id',v_room.id,
    'revision',v_room.phase_revision,
    'current_phase',v_room.current_phase,
    'livekit_room_name',v_room.livekit_room_name,
    'participant_policies',v_policies
  );
end;
$$;

create or replace function public.claim_conference_phase_enforcement(
  p_event_id uuid
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.claim_conference_phase_enforcement(p_event_id)
$$;

revoke execute on function private.claim_conference_phase_enforcement(uuid)
from public,anon,authenticated;
grant execute on function private.claim_conference_phase_enforcement(uuid)
to service_role;
revoke execute on function public.claim_conference_phase_enforcement(uuid)
from public,anon,authenticated;
grant execute on function public.claim_conference_phase_enforcement(uuid)
to service_role;

create or replace function private.complete_conference_phase_enforcement(
  p_event_id uuid,
  p_success boolean,
  p_error text default null,
  p_participants_updated integer default 0,
  p_participants_offline integer default 0
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.conference_phase_events%rowtype;
begin
  update public.conference_phase_events
  set runtime_sync_status=case
        when p_success then 'DONE' else 'FAILED'
      end,
      enforced_at=case
        when p_success then clock_timestamp() else enforced_at
      end,
      last_enforcement_error=case
        when p_success then null
        else left(coalesce(p_error,'unknown'),500)
      end,
      participants_updated=greatest(0,coalesce(p_participants_updated,0)),
      participants_offline=greatest(0,coalesce(p_participants_offline,0)),
      updated_at=clock_timestamp()
  where id=p_event_id
    and runtime_sync_status<>'SUPERSEDED'
  returning * into v_event;

  if found then
    insert into public.conference_audit_events(
      room_id,actor_user_id,event_type,metadata
    )
    values(
      v_event.room_id,null,
      case
        when p_success then 'conference_phase_enforced'
        else 'conference_phase_enforcement_failed'
      end,
      jsonb_build_object(
        'event_id',v_event.id,
        'revision',v_event.revision,
        'phase',v_event.to_phase,
        'participants_updated',
          greatest(0,coalesce(p_participants_updated,0)),
        'participants_offline',
          greatest(0,coalesce(p_participants_offline,0)),
        'error',case
          when p_success then null
          else left(coalesce(p_error,'unknown'),500)
        end
      )
    );
  end if;
end;
$$;

create or replace function public.complete_conference_phase_enforcement(
  p_event_id uuid,
  p_success boolean,
  p_error text default null,
  p_participants_updated integer default 0,
  p_participants_offline integer default 0
)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.complete_conference_phase_enforcement(
    p_event_id,p_success,p_error,
    p_participants_updated,p_participants_offline
  )
$$;

revoke execute on function private.complete_conference_phase_enforcement(
  uuid,boolean,text,integer,integer
) from public,anon,authenticated;
grant execute on function private.complete_conference_phase_enforcement(
  uuid,boolean,text,integer,integer
) to service_role;
revoke execute on function public.complete_conference_phase_enforcement(
  uuid,boolean,text,integer,integer
) from public,anon,authenticated;
grant execute on function public.complete_conference_phase_enforcement(
  uuid,boolean,text,integer,integer
) to service_role;

create or replace function private.advance_conference_phase_timers()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room record;
  v_result jsonb;
  v_count integer:=0;
begin
  for v_room in
    select r.id,r.current_phase
    from public.conference_rooms r
    where r.status<>'ended'
      and r.phase_ends_at is not null
      and r.phase_ends_at<=clock_timestamp()
      and r.current_phase in ('COUNTDOWN','BREAK','RESUMING')
    order by r.phase_ends_at
    limit 20
    for update skip locked
  loop
    if v_room.current_phase='COUNTDOWN' then
      v_result:=private.transition_conference_phase(
        v_room.id,'LIVE',null,null,
        'countdown_elapsed',true,true,true
      );
    elsif v_room.current_phase='BREAK' then
      v_result:=private.transition_conference_phase(
        v_room.id,'RESUMING',1,null,
        'break_elapsed',false,false,true
      );
    else
      v_result:=private.transition_conference_phase(
        v_room.id,'LIVE',null,null,
        'resuming_elapsed',true,true,true
      );
    end if;

    if coalesce((v_result->>'ok')::boolean,false) then
      v_count:=v_count+1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function private.advance_conference_phase_timers()
from public,anon,authenticated;
grant execute on function private.advance_conference_phase_timers()
to service_role;

create or replace function private.configure_conference_phase_worker(
  p_url text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if nullif(trim(p_url),'') is null or p_url !~ '^https?://' then
    raise exception 'invalid worker url';
  end if;

  insert into private.conference_phase_worker_config(
    key,value,updated_at
  )
  values('worker_url',trim(p_url),now())
  on conflict(key) do update
  set value=excluded.value,updated_at=now();
end;
$$;

revoke execute on function private.configure_conference_phase_worker(text)
from public,anon,authenticated;
grant execute on function private.configure_conference_phase_worker(text)
to service_role;

create or replace function private.verify_conference_phase_worker_secret(
  p_secret text
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from vault.decrypted_secrets s
    where s.name='conference_phase_worker_secret'
      and s.decrypted_secret=p_secret
  )
$$;

revoke execute on function private.verify_conference_phase_worker_secret(text)
from public,anon,authenticated;
grant execute on function private.verify_conference_phase_worker_secret(text)
to service_role;

create or replace function public.verify_conference_phase_worker_secret(
  p_secret text
)
returns boolean
language sql
security invoker
set search_path=''
as $$
  select private.verify_conference_phase_worker_secret(p_secret)
$$;

revoke execute on function public.verify_conference_phase_worker_secret(text)
from public,anon,authenticated;
grant execute on function public.verify_conference_phase_worker_secret(text)
to service_role;

create or replace function private.dispatch_conference_phase_enforcement()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_url text;
  v_secret text;
  v_row record;
  v_count integer:=0;
begin
  perform private.advance_conference_phase_timers();

  select c.value into v_url
  from private.conference_phase_worker_config c
  where c.key='worker_url';

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name='conference_phase_worker_secret';

  if nullif(v_url,'') is null or nullif(v_secret,'') is null then
    return 0;
  end if;

  for v_row in
    select e.id
    from public.conference_phase_events e
    where e.runtime_sync_status in ('PENDING','FAILED')
       or (
         e.runtime_sync_status='DISPATCHED'
         and e.last_dispatched_at<
           clock_timestamp()-interval '15 seconds'
       )
    order by e.created_at,e.revision
    limit 20
    for update skip locked
  loop
    begin
      update public.conference_phase_events
      set runtime_sync_status='DISPATCHED',
          last_dispatched_at=clock_timestamp(),
          enforcement_attempts=enforcement_attempts+1,
          updated_at=clock_timestamp()
      where id=v_row.id;

      perform net.http_post(
        url:=v_url,
        headers:=jsonb_build_object(
          'Content-Type','application/json',
          'X-Conference-Phase-Secret',v_secret
        ),
        body:=jsonb_build_object('eventId',v_row.id),
        timeout_milliseconds:=5000
      );

      v_count:=v_count+1;
    exception when others then
      update public.conference_phase_events
      set runtime_sync_status='FAILED',
          last_enforcement_error=left(sqlerrm,500),
          updated_at=clock_timestamp()
      where id=v_row.id;
    end;
  end loop;

  return v_count;
end;
$$;

revoke execute on function private.dispatch_conference_phase_enforcement()
from public,anon,authenticated;
grant execute on function private.dispatch_conference_phase_enforcement()
to service_role;

create or replace function private.end_conference_room(
  p_room_id uuid,
  p_reason text default 'ended_by_host'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transition jsonb;
begin
  if auth.uid() is null
     or not private.has_conference_permission(
       p_room_id,'END_MEETING',auth.uid()
     ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if exists(
    select 1 from public.conference_rooms
    where id=p_room_id and status<>'ended'
  ) then
    v_transition:=private.transition_conference_phase(
      p_room_id,'ENDED',null,auth.uid(),
      coalesce(nullif(trim(p_reason),''),'ended_by_host'),
      false,false,false
    );

    if coalesce((v_transition->>'ok')::boolean,false) is not true then
      return v_transition;
    end if;
  end if;

  update public.conference_participants
  set status='left',
      left_at=coalesce(left_at,now()),
      last_seen=now()
  where room_id=p_room_id and status='joined';

  return jsonb_build_object('ok',true);
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_phase_events'
  ) then
    alter publication supabase_realtime
      add table public.conference_phase_events;
  end if;
end
$$;

select cron.schedule(
  'conference-phase-enforcer',
  '1 second',
  'select private.dispatch_conference_phase_enforcement();'
);

notify pgrst,'reload schema';
