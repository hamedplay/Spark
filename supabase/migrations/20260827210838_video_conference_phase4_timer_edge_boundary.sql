create or replace function private.authorize_conference_speaker_timer_action(
  p_room_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_seconds integer default null
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_action text:=lower(trim(coalesce(p_action,'')));
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
  elsif v_action='extend' then
    if p_seconds is null or p_seconds<1 or p_seconds>3600 then
      return jsonb_build_object('ok',false,'reason','invalid_extension');
    end if;
  elsif v_action not in ('pause','resume','stop') then
    return jsonb_build_object('ok',false,'reason','unknown_action');
  end if;

  return jsonb_build_object('ok',true,'actor_user_id',v_actor,'action',v_action);
end;
$$;

create or replace function public.authorize_conference_speaker_timer_action(
  p_room_id uuid,p_target_user_id uuid,p_action text,p_seconds integer default null
)
returns jsonb language sql stable security invoker set search_path=''
as $$
  select private.authorize_conference_speaker_timer_action(
    p_room_id,p_target_user_id,p_action,p_seconds
  )
$$;

revoke execute on function private.authorize_conference_speaker_timer_action(uuid,uuid,text,integer) from public,anon;
grant execute on function private.authorize_conference_speaker_timer_action(uuid,uuid,text,integer) to authenticated,service_role;
revoke execute on function public.authorize_conference_speaker_timer_action(uuid,uuid,text,integer) from public,anon;
grant execute on function public.authorize_conference_speaker_timer_action(uuid,uuid,text,integer) to authenticated,service_role;

create or replace function private.apply_conference_speaker_timer_action(
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
  v_session public.conference_speaker_sessions%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_elapsed integer:=0;
  v_remaining integer:=0;
begin
  if p_actor_user_id is null then
    return jsonb_build_object('ok',false,'reason','actor_required');
  end if;
  if not private.has_conference_permission(p_room_id,'MANAGE_TIMER',p_actor_user_id) then
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

    update public.conference_rooms set speaking_limit_enabled=true where id=p_room_id;

    insert into public.conference_speaker_sessions(
      room_id,user_id,granted_by,starts_at,active_started_at,
      expires_at,allocated_seconds,used_seconds,status,
      enforcement_status,enforcement_requested_at
    )
    values(
      p_room_id,p_target_user_id,p_actor_user_id,v_now,v_now,
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
      p_room_id,p_actor_user_id,p_target_user_id,'speaker_timer_started',
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
                          then expires_at+make_interval(secs=>p_seconds) else expires_at end,
          updated_at=v_now
      where id=v_session.id returning * into v_session;
      insert into public.conference_audit_events(room_id,actor_user_id,target_user_id,event_type,metadata)
      values(p_room_id,p_actor_user_id,p_target_user_id,'speaker_timer_extended',
             jsonb_build_object('session_id',v_session.id,'added_seconds',p_seconds));

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
      where id=v_session.id returning * into v_session;
      insert into public.conference_audit_events(room_id,actor_user_id,target_user_id,event_type,metadata)
      values(p_room_id,p_actor_user_id,p_target_user_id,'speaker_timer_paused',
             jsonb_build_object('session_id',v_session.id));

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
      where id=v_session.id returning * into v_session;
      insert into public.conference_audit_events(room_id,actor_user_id,target_user_id,event_type,metadata)
      values(p_room_id,p_actor_user_id,p_target_user_id,'speaker_timer_resumed',
             jsonb_build_object('session_id',v_session.id));

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
      where id=v_session.id returning * into v_session;
      insert into public.conference_audit_events(room_id,actor_user_id,target_user_id,event_type,metadata)
      values(p_room_id,p_actor_user_id,p_target_user_id,'speaker_timer_stopped',
             jsonb_build_object('session_id',v_session.id));
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

create or replace function public.apply_livekit_conference_speaker_timer_action(
  p_room_id uuid,p_target_user_id uuid,p_action text,p_seconds integer,p_actor_user_id uuid
)
returns jsonb language sql security invoker set search_path=''
as $$
  select private.apply_conference_speaker_timer_action(
    p_room_id,p_target_user_id,p_action,p_seconds,p_actor_user_id
  )
$$;

revoke execute on function private.apply_conference_speaker_timer_action(uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function private.apply_conference_speaker_timer_action(uuid,uuid,text,integer,uuid) to service_role;
revoke execute on function public.apply_livekit_conference_speaker_timer_action(uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.apply_livekit_conference_speaker_timer_action(uuid,uuid,text,integer,uuid) to service_role;

revoke execute on function public.control_conference_speaker_timer(uuid,uuid,text,integer) from authenticated;
revoke execute on function private.control_conference_speaker_timer(uuid,uuid,text,integer) from authenticated;
grant execute on function public.control_conference_speaker_timer(uuid,uuid,text,integer) to service_role;
grant execute on function private.control_conference_speaker_timer(uuid,uuid,text,integer) to service_role;

create or replace function private.set_conference_participant_speaking_limit(
  p_room_id uuid,p_target_user_id uuid,p_seconds integer
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is null
     or not private.has_conference_permission(p_room_id,'MANAGE_TIMER',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  if exists (
    select 1 from public.conference_rooms r
    where r.id=p_room_id and r.media_topology='sfu'
  ) then
    return jsonb_build_object('ok',false,'reason','use_speaker_timer_engine');
  end if;
  if p_seconds<10 or p_seconds>600 then
    return jsonb_build_object('ok',false,'reason','invalid_limit');
  end if;
  update public.conference_participants
  set speaking_limit_seconds=p_seconds
  where room_id=p_room_id and user_id=p_target_user_id;
  return jsonb_build_object('ok',found);
end;
$$;

create or replace function private.set_conference_speaking_limit_enabled(
  p_room_id uuid,p_enabled boolean
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is null
     or not private.has_conference_permission(p_room_id,'MANAGE_TIMER',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  if exists (
    select 1 from public.conference_rooms r
    where r.id=p_room_id and r.media_topology='sfu'
  ) then
    return jsonb_build_object('ok',false,'reason','use_speaker_timer_engine');
  end if;
  update public.conference_rooms
  set speaking_limit_enabled=p_enabled
  where id=p_room_id and status<>'ended';
  return jsonb_build_object('ok',found);
end;
$$;

notify pgrst,'reload schema';
