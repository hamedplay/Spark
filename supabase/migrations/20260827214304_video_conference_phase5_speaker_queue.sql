alter table public.conference_speaker_sessions
  add column if not exists queue_position bigint;

alter table public.conference_speaker_sessions
  drop constraint if exists conference_speaker_sessions_queue_position_check;

alter table public.conference_speaker_sessions
  add constraint conference_speaker_sessions_queue_position_check
  check (queue_position is null or queue_position > 0);

create index if not exists conference_speaker_sessions_queue_idx
  on public.conference_speaker_sessions(room_id, queue_position, created_at)
  where status='QUEUED';

with ranked as (
  select s.id,
         row_number() over (
           partition by s.room_id order by s.created_at,s.id
         )::bigint as queue_position
  from public.conference_speaker_sessions s
  where s.status='QUEUED'
)
update public.conference_speaker_sessions s
set queue_position=r.queue_position
from ranked r
where r.id=s.id
  and s.queue_position is distinct from r.queue_position;

with candidates as (
  select
    p.room_id,p.user_id,p.user_id as granted_by,
    coalesce(p.hand_raised_at,p.updated_at,clock_timestamp()) as raised_at,
    greatest(10,least(coalesce(p.speaking_limit_seconds,60),3600))::integer as allocated_seconds,
    row_number() over (
      partition by p.room_id
      order by coalesce(p.hand_raised_at,p.updated_at,clock_timestamp()),p.user_id
    )::bigint as queue_position
  from public.conference_participants p
  join public.conference_rooms r on r.id=p.room_id
  where p.status='joined'
    and p.is_hand_raised
    and r.status<>'ended'
    and r.media_topology='sfu'
    and r.livekit_room_name is not null
    and private.has_conference_permission(p.room_id,'PUBLISH_MIC',p.user_id)
    and not exists (
      select 1
      from public.conference_speaker_sessions s
      where s.room_id=p.room_id
        and s.user_id=p.user_id
        and s.status in ('QUEUED','ACTIVE','PAUSED')
    )
),
offsets as (
  select room_id,coalesce(max(queue_position),0)::bigint as base_position
  from public.conference_speaker_sessions
  where status='QUEUED'
  group by room_id
)
insert into public.conference_speaker_sessions(
  room_id,user_id,granted_by,starts_at,active_started_at,expires_at,
  allocated_seconds,used_seconds,status,queue_position,
  enforcement_status,enforcement_requested_at
)
select
  c.room_id,c.user_id,c.granted_by,c.raised_at,null,null,
  c.allocated_seconds,0,'QUEUED',
  coalesce(o.base_position,0)+c.queue_position,
  'PENDING',clock_timestamp()
from candidates c
left join offsets o on o.room_id=c.room_id;

update public.conference_rooms r
set speaking_limit_enabled=true
where r.media_topology='sfu'
  and exists (
    select 1 from public.conference_speaker_sessions s
    where s.room_id=r.id and s.status='QUEUED'
  );

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

    if v_session_status in ('QUEUED','PAUSED','EXPIRED','COMPLETED') then
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

create or replace function private.get_conference_speaker_timer_snapshot(
  p_room_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_can_manage boolean:=false;
  v_sessions jsonb;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'reason','not_authenticated',
      'server_time',clock_timestamp(),'sessions','[]'::jsonb
    );
  end if;

  if not exists (
    select 1
    from public.conference_rooms r
    where r.id=p_room_id
      and (
        r.host_id=v_uid
        or exists(
          select 1
          from public.conference_participants p
          where p.room_id=p_room_id and p.user_id=v_uid
        )
      )
  ) then
    return jsonb_build_object(
      'ok',false,'reason','not_authorized',
      'server_time',clock_timestamp(),'sessions','[]'::jsonb
    );
  end if;

  v_can_manage:=private.has_conference_permission(
    p_room_id,'MANAGE_TIMER',v_uid
  );

  select coalesce(
    jsonb_agg(
      to_jsonb(q)
      order by
        case when q.status='QUEUED' then 0 else 1 end,
        q.queue_position nulls last,
        q.created_at desc
    ),
    '[]'::jsonb
  )
  into v_sessions
  from (
    select distinct on (s.user_id)
      s.id,s.room_id,s.user_id,s.granted_by,s.starts_at,
      s.active_started_at,s.expires_at,s.allocated_seconds,
      s.used_seconds,s.status,s.queue_position,s.paused_at,
      s.ended_at,s.end_reason,s.created_at,s.updated_at
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id
      and s.status<>'CANCELLED'
      and (v_can_manage or s.user_id=v_uid)
    order by s.user_id,s.created_at desc
  ) q;

  return jsonb_build_object(
    'ok',true,'server_time',clock_timestamp(),
    'can_manage',v_can_manage,'sessions',v_sessions
  );
end;
$$;

create or replace function private.set_livekit_raise_hand(
  p_room_id uuid,p_raised boolean
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_now timestamptz:=clock_timestamp();
  v_topology text;
  v_room_name text;
  v_limit integer;
  v_position bigint;
  v_session public.conference_speaker_sessions%rowtype;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select r.media_topology,r.livekit_room_name
  into v_topology,v_room_name
  from public.conference_rooms r
  where r.id=p_room_id and r.status<>'ended'
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  select greatest(10,least(coalesce(p.speaking_limit_seconds,60),3600))::integer
  into v_limit
  from public.conference_participants p
  where p.room_id=p_room_id and p.user_id=v_uid and p.status='joined'
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','participant_not_joined');
  end if;

  if v_topology<>'sfu' then
    update public.conference_participants
    set is_hand_raised=p_raised,
        hand_raised_at=case
          when p_raised then coalesce(hand_raised_at,v_now)
          else null
        end,
        updated_at=v_now
    where room_id=p_room_id and user_id=v_uid and status='joined';

    return jsonb_build_object('ok',true,'raised',p_raised,'legacy_mesh',true);
  end if;

  if v_room_name is null then
    return jsonb_build_object('ok',false,'reason','livekit_room_missing');
  end if;

  if p_raised then
    if not private.has_conference_permission(
      p_room_id,'PUBLISH_MIC',v_uid
    ) then
      return jsonb_build_object('ok',false,'reason','microphone_not_allowed');
    end if;

    select *
    into v_session
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id
      and s.user_id=v_uid
      and s.status in ('QUEUED','ACTIVE','PAUSED')
    order by s.created_at desc
    limit 1
    for update;

    if found then
      if v_session.status in ('ACTIVE','PAUSED') then
        return jsonb_build_object('ok',false,'reason','already_speaking');
      end if;

      update public.conference_participants
      set is_hand_raised=true,
          hand_raised_at=coalesce(hand_raised_at,v_session.starts_at,v_now),
          updated_at=v_now
      where room_id=p_room_id and user_id=v_uid and status='joined';

      return jsonb_build_object(
        'ok',true,'raised',true,'queued',true,
        'session',to_jsonb(v_session)
      );
    end if;

    select coalesce(max(s.queue_position),0)+1
    into v_position
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id and s.status='QUEUED';

    update public.conference_rooms
    set speaking_limit_enabled=true
    where id=p_room_id;

    update public.conference_participants
    set is_hand_raised=true,
        hand_raised_at=coalesce(hand_raised_at,v_now),
        updated_at=v_now
    where room_id=p_room_id and user_id=v_uid and status='joined';

    insert into public.conference_speaker_sessions(
      room_id,user_id,granted_by,starts_at,active_started_at,
      expires_at,allocated_seconds,used_seconds,status,
      queue_position,enforcement_status,enforcement_requested_at
    )
    values(
      p_room_id,v_uid,v_uid,
      coalesce((
        select p.hand_raised_at
        from public.conference_participants p
        where p.room_id=p_room_id and p.user_id=v_uid
      ),v_now),
      null,null,v_limit,0,'QUEUED',
      v_position,'PENDING',v_now
    )
    returning * into v_session;

    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,v_uid,v_uid,'speaker_queue_joined',
      jsonb_build_object(
        'session_id',v_session.id,
        'queue_position',v_session.queue_position,
        'allocated_seconds',v_session.allocated_seconds
      )
    );

    return jsonb_build_object(
      'ok',true,'raised',true,'queued',true,
      'session',to_jsonb(v_session),
      'livekit_policy',
        private.conference_livekit_policy_for_user(p_room_id,v_uid)
    );
  end if;

  update public.conference_participants
  set is_hand_raised=false,hand_raised_at=null,updated_at=v_now
  where room_id=p_room_id and user_id=v_uid and status='joined';

  update public.conference_speaker_sessions
  set status='CANCELLED',
      queue_position=null,
      ended_at=v_now,
      end_reason='hand_lowered',
      enforcement_status='PENDING',
      enforcement_requested_at=v_now,
      enforced_at=null,
      last_enforcement_error=null,
      updated_at=v_now
  where room_id=p_room_id and user_id=v_uid and status='QUEUED'
  returning * into v_session;

  if found then
    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,v_uid,v_uid,'speaker_queue_left',
      jsonb_build_object('session_id',v_session.id,'reason','hand_lowered')
    );
  end if;

  return jsonb_build_object(
    'ok',true,'raised',false,
    'session',case when v_session.id is null then null else to_jsonb(v_session) end,
    'livekit_policy',
      private.conference_livekit_policy_for_user(p_room_id,v_uid)
  );
end;
$$;

create or replace function private.moderate_conference_participant(
  p_room_id uuid,p_target_user_id uuid,p_action text
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_permission text;
  v_session public.conference_speaker_sessions%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_is_sfu boolean:=false;
begin
  v_permission:=case p_action
    when 'kick' then 'REMOVE_PARTICIPANT'
    when 'mute' then 'MUTE_OTHERS'
    when 'lower_hand' then 'MUTE_OTHERS'
    else null
  end;

  if v_permission is null
     or auth.uid() is null
     or not private.has_conference_permission(
       p_room_id,v_permission,auth.uid()
     ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if p_target_user_id=auth.uid() then
    return jsonb_build_object('ok',false,'reason','cannot_target_self');
  end if;

  select exists(
    select 1 from public.conference_rooms r
    where r.id=p_room_id and r.media_topology='sfu'
  ) into v_is_sfu;

  if p_action='kick' then
    update public.conference_participants
    set status='left',left_at=now(),last_seen=now()
    where room_id=p_room_id and user_id=p_target_user_id and status='joined';

    insert into public.room_mod_actions(
      room_id,by_admin_id,target_user_id,action_type
    )
    values(p_room_id,auth.uid()::text,p_target_user_id::text,'kick');

  elsif p_action='mute' then
    update public.conference_participants
    set is_muted=true
    where room_id=p_room_id and user_id=p_target_user_id and status='joined';

    insert into public.room_mod_actions(
      room_id,by_admin_id,target_user_id,action_type
    )
    values(p_room_id,auth.uid()::text,p_target_user_id::text,'mute');

  else
    update public.conference_participants
    set is_hand_raised=false,hand_raised_at=null,updated_at=v_now
    where room_id=p_room_id
      and user_id=p_target_user_id
      and status='joined';

    if not found then
      return jsonb_build_object('ok',false,'reason','participant_not_found');
    end if;

    if v_is_sfu then
      update public.conference_speaker_sessions
      set status='CANCELLED',
          queue_position=null,
          ended_at=v_now,
          end_reason='lowered_by_moderator',
          enforcement_status='PENDING',
          enforcement_requested_at=v_now,
          enforced_at=null,
          last_enforcement_error=null,
          updated_at=v_now
      where room_id=p_room_id
        and user_id=p_target_user_id
        and status='QUEUED'
      returning * into v_session;

      if found then
        insert into public.conference_audit_events(
          room_id,actor_user_id,target_user_id,event_type,metadata
        )
        values(
          p_room_id,auth.uid(),p_target_user_id,'speaker_queue_removed',
          jsonb_build_object(
            'session_id',v_session.id,
            'reason','lowered_by_moderator'
          )
        );
      end if;
    end if;

    return jsonb_build_object(
      'ok',true,
      'session',case when v_session.id is null then null else to_jsonb(v_session) end,
      'livekit_policy',
        case when v_is_sfu
          then private.conference_livekit_policy_for_user(
            p_room_id,p_target_user_id
          )
          else null
        end
    );
  end if;

  return jsonb_build_object('ok',true);
end;
$$;

create or replace function private.authorize_conference_speaker_queue_action(
  p_room_id uuid,p_target_user_id uuid,p_action text,p_seconds integer default null
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_action text:=lower(trim(coalesce(p_action,'')));
begin
  if v_actor is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  if not private.has_conference_permission(
    p_room_id,'MANAGE_TIMER',v_actor
  ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if v_action not in ('move_up','move_down','remove','set_time','allow') then
    return jsonb_build_object('ok',false,'reason','unknown_action');
  end if;

  if not exists (
    select 1
    from public.conference_rooms r
    where r.id=p_room_id
      and r.status<>'ended'
      and r.media_topology='sfu'
      and r.livekit_room_name is not null
  ) then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if not exists (
    select 1 from public.conference_participants p
    where p.room_id=p_room_id
      and p.user_id=p_target_user_id
      and p.status='joined'
  ) then
    return jsonb_build_object('ok',false,'reason','participant_not_found');
  end if;

  if not exists (
    select 1
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id
      and s.user_id=p_target_user_id
      and s.status='QUEUED'
  ) then
    return jsonb_build_object('ok',false,'reason','queue_entry_not_found');
  end if;

  if v_action='set_time'
     and (p_seconds is null or p_seconds<10 or p_seconds>3600) then
    return jsonb_build_object('ok',false,'reason','invalid_duration');
  end if;

  if v_action='allow'
     and not private.has_conference_permission(
       p_room_id,'PUBLISH_MIC',p_target_user_id
     ) then
    return jsonb_build_object('ok',false,'reason','microphone_not_allowed');
  end if;

  return jsonb_build_object(
    'ok',true,'actor_user_id',v_actor,'action',v_action
  );
end;
$$;

create or replace function public.authorize_conference_speaker_queue_action(
  p_room_id uuid,p_target_user_id uuid,p_action text,p_seconds integer default null
)
returns jsonb
language sql stable security invoker set search_path=''
as $$
  select private.authorize_conference_speaker_queue_action(
    p_room_id,p_target_user_id,p_action,p_seconds
  )
$$;

create or replace function private.apply_conference_speaker_queue_action(
  p_room_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_seconds integer,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_now timestamptz:=clock_timestamp();
  v_session public.conference_speaker_sessions%rowtype;
  v_other public.conference_speaker_sessions%rowtype;
  v_timer jsonb;
begin
  if p_actor_user_id is null
     or not private.has_conference_permission(
       p_room_id,'MANAGE_TIMER',p_actor_user_id
     ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  perform 1
  from public.conference_rooms r
  where r.id=p_room_id
    and r.status<>'ended'
    and r.media_topology='sfu'
    and r.livekit_room_name is not null
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  select *
  into v_session
  from public.conference_speaker_sessions s
  where s.room_id=p_room_id
    and s.user_id=p_target_user_id
    and s.status='QUEUED'
  order by s.created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','queue_entry_not_found');
  end if;

  if v_action='move_up' then
    select *
    into v_other
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id
      and s.status='QUEUED'
      and s.id<>v_session.id
      and s.queue_position<v_session.queue_position
    order by s.queue_position desc,s.created_at desc
    limit 1
    for update;

    if found then
      update public.conference_speaker_sessions
      set queue_position=v_session.queue_position,updated_at=v_now
      where id=v_other.id;

      update public.conference_speaker_sessions
      set queue_position=v_other.queue_position,updated_at=v_now
      where id=v_session.id
      returning * into v_session;
    end if;

  elsif v_action='move_down' then
    select *
    into v_other
    from public.conference_speaker_sessions s
    where s.room_id=p_room_id
      and s.status='QUEUED'
      and s.id<>v_session.id
      and s.queue_position>v_session.queue_position
    order by s.queue_position,s.created_at
    limit 1
    for update;

    if found then
      update public.conference_speaker_sessions
      set queue_position=v_session.queue_position,updated_at=v_now
      where id=v_other.id;

      update public.conference_speaker_sessions
      set queue_position=v_other.queue_position,updated_at=v_now
      where id=v_session.id
      returning * into v_session;
    end if;

  elsif v_action='set_time' then
    if p_seconds is null or p_seconds<10 or p_seconds>3600 then
      return jsonb_build_object('ok',false,'reason','invalid_duration');
    end if;

    update public.conference_speaker_sessions
    set allocated_seconds=p_seconds,updated_at=v_now
    where id=v_session.id
    returning * into v_session;

    update public.conference_participants
    set speaking_limit_seconds=p_seconds
    where room_id=p_room_id and user_id=p_target_user_id;

  elsif v_action='remove' then
    update public.conference_speaker_sessions
    set status='CANCELLED',
        queue_position=null,
        ended_at=v_now,
        end_reason='removed_from_queue',
        enforcement_status='PENDING',
        enforcement_requested_at=v_now,
        enforced_at=null,
        last_enforcement_error=null,
        updated_at=v_now
    where id=v_session.id
    returning * into v_session;

    update public.conference_participants
    set is_hand_raised=false,hand_raised_at=null,updated_at=v_now
    where room_id=p_room_id and user_id=p_target_user_id;

  elsif v_action='allow' then
    if not private.has_conference_permission(
      p_room_id,'PUBLISH_MIC',p_target_user_id
    ) then
      return jsonb_build_object('ok',false,'reason','microphone_not_allowed');
    end if;

    v_timer:=private.apply_conference_speaker_timer_action(
      p_room_id,p_target_user_id,'start',
      v_session.allocated_seconds,p_actor_user_id
    );

    if coalesce((v_timer->>'ok')::boolean,false) is not true then
      return v_timer;
    end if;

    update public.conference_participants
    set is_hand_raised=false,hand_raised_at=null,updated_at=v_now
    where room_id=p_room_id and user_id=p_target_user_id;

    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,p_actor_user_id,p_target_user_id,'speaker_queue_allowed',
      jsonb_build_object(
        'queued_session_id',v_session.id,
        'active_session_id',v_timer->'session'->>'id',
        'allocated_seconds',v_session.allocated_seconds
      )
    );

    return v_timer;
  else
    return jsonb_build_object('ok',false,'reason','unknown_action');
  end if;

  insert into public.conference_audit_events(
    room_id,actor_user_id,target_user_id,event_type,metadata
  )
  values(
    p_room_id,p_actor_user_id,p_target_user_id,
    case v_action
      when 'move_up' then 'speaker_queue_moved_up'
      when 'move_down' then 'speaker_queue_moved_down'
      when 'set_time' then 'speaker_queue_time_set'
      when 'remove' then 'speaker_queue_removed'
    end,
    jsonb_build_object(
      'session_id',v_session.id,
      'queue_position',v_session.queue_position,
      'allocated_seconds',v_session.allocated_seconds
    )
  );

  return jsonb_build_object(
    'ok',true,'server_time',v_now,'session',to_jsonb(v_session),
    'livekit_policy',
      private.conference_livekit_policy_for_user(
        p_room_id,p_target_user_id
      ),
    'runtime_sync_required',v_action='remove'
  );
end;
$$;

create or replace function public.apply_livekit_conference_speaker_queue_action(
  p_room_id uuid,p_target_user_id uuid,p_action text,p_seconds integer,p_actor_user_id uuid
)
returns jsonb
language sql security invoker set search_path=''
as $$
  select private.apply_conference_speaker_queue_action(
    p_room_id,p_target_user_id,p_action,p_seconds,p_actor_user_id
  )
$$;

revoke execute on function
  private.authorize_conference_speaker_queue_action(uuid,uuid,text,integer)
from public,anon;
grant execute on function
  private.authorize_conference_speaker_queue_action(uuid,uuid,text,integer)
to authenticated,service_role;

revoke execute on function
  public.authorize_conference_speaker_queue_action(uuid,uuid,text,integer)
from public,anon;
grant execute on function
  public.authorize_conference_speaker_queue_action(uuid,uuid,text,integer)
to authenticated,service_role;

revoke execute on function
  private.apply_conference_speaker_queue_action(uuid,uuid,text,integer,uuid)
from public,anon,authenticated;
grant execute on function
  private.apply_conference_speaker_queue_action(uuid,uuid,text,integer,uuid)
to service_role;

revoke execute on function
  public.apply_livekit_conference_speaker_queue_action(uuid,uuid,text,integer,uuid)
from public,anon,authenticated;
grant execute on function
  public.apply_livekit_conference_speaker_queue_action(uuid,uuid,text,integer,uuid)
to service_role;

notify pgrst,'reload schema';
