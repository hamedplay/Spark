
alter table public.conference_participants
  add column if not exists mic_publishing_disabled boolean not null default false,
  add column if not exists camera_publishing_disabled boolean not null default false,
  add column if not exists screen_publishing_disabled boolean not null default false;

insert into private.conference_permissions(permission)
values ('DISABLE_SCREEN')
on conflict(permission) do nothing;

insert into private.conference_role_permissions(role,permission)
select r.role,'DISABLE_SCREEN'
from private.conference_rbac_roles r
where r.role in ('OWNER','HOST','CO_HOST','MODERATOR')
on conflict(role,permission) do nothing;

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
  v_mic_disabled boolean := false;
  v_camera_disabled boolean := false;
  v_screen_disabled boolean := false;
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

  select
    coalesce(p.mic_publishing_disabled,false),
    coalesce(p.camera_publishing_disabled,false),
    coalesce(p.screen_publishing_disabled,false)
  into
    v_mic_disabled,
    v_camera_disabled,
    v_screen_disabled
  from public.conference_participants p
  where p.room_id=p_room_id and p.user_id=p_user_id;

  v_mic_disabled:=coalesce(v_mic_disabled,false);
  v_camera_disabled:=coalesce(v_camera_disabled,false);
  v_screen_disabled:=coalesce(v_screen_disabled,false);

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

  v_can_publish_microphone:=
    'PUBLISH_MIC'=any(v_permissions) and not v_mic_disabled;
  v_can_publish_camera:=
    'PUBLISH_CAMERA'=any(v_permissions) and not v_camera_disabled;

  if v_current_phase in ('COUNTDOWN','RESUMING') then
    v_can_publish_microphone:=false;
    v_can_publish_camera:=false;
  elsif v_current_phase='BREAK' then
    v_can_publish_microphone:=
      v_can_publish_microphone and v_phase_allow_mic;
    v_can_publish_camera:=
      v_can_publish_camera and v_phase_allow_camera;
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

  if v_allow_screen_share
     and not v_screen_disabled
     and 'PUBLISH_SCREEN'=any(v_permissions) then
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
    'publish_sources',v_sources,
    'media_restrictions',jsonb_build_object(
      'microphone_disabled',v_mic_disabled,
      'camera_disabled',v_camera_disabled,
      'screen_disabled',v_screen_disabled
    )
  );
end;
$$;

create or replace function private.authorize_livekit_host_action(
  p_room_id uuid,
  p_target_user_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.conference_rooms%rowtype;
  v_permission text;
  v_role text;
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select * into v_room
  from public.conference_rooms
  where id=p_room_id;

  if not found
     or v_room.media_topology<>'sfu'
     or v_room.livekit_room_name is null then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  v_permission:=case p_action
    when 'remove' then 'REMOVE_PARTICIPANT'
    when 'mute' then 'MUTE_OTHERS'
    when 'lower-hand' then 'MUTE_OTHERS'
    when 'promote' then 'MANAGE_ROLES'
    when 'demote' then 'MANAGE_ROLES'
    when 'set-role' then 'MANAGE_ROLES'
    when 'disable-mic' then 'DISABLE_MIC'
    when 'enable-mic' then 'DISABLE_MIC'
    when 'disable-camera' then 'DISABLE_CAMERA'
    when 'enable-camera' then 'DISABLE_CAMERA'
    when 'disable-screen' then 'DISABLE_SCREEN'
    when 'enable-screen' then 'DISABLE_SCREEN'
    when 'lock' then 'LOCK_ROOM'
    when 'unlock' then 'LOCK_ROOM'
    when 'end' then 'END_MEETING'
    else null
  end;

  if v_permission is null
     or not private.has_conference_permission(
       p_room_id,v_permission,auth.uid()
     ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if p_target_user_id is not null
     and p_target_user_id=auth.uid() then
    return jsonb_build_object('ok',false,'reason','cannot_target_self');
  end if;

  v_role:=private.conference_effective_role(p_room_id,auth.uid());

  return jsonb_build_object(
    'ok',true,
    'role',v_role,
    'permission',v_permission,
    'livekit_room_name',v_room.livekit_room_name,
    'room_id',v_room.id
  );
end;
$$;

create or replace function private.set_livekit_participant_media_permission(
  p_room_id uuid,
  p_target_user_id uuid,
  p_source text,
  p_disabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_permission text;
  v_policy jsonb;
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  if p_target_user_id is null or p_target_user_id=auth.uid() then
    return jsonb_build_object('ok',false,'reason','cannot_target_self');
  end if;

  v_permission:=case p_source
    when 'microphone' then 'DISABLE_MIC'
    when 'camera' then 'DISABLE_CAMERA'
    when 'screen_share' then 'DISABLE_SCREEN'
    else null
  end;

  if v_permission is null then
    return jsonb_build_object('ok',false,'reason','invalid_source');
  end if;

  if not private.has_conference_permission(
    p_room_id,v_permission,auth.uid()
  ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if p_source='microphone' then
    update public.conference_participants
    set mic_publishing_disabled=coalesce(p_disabled,false),
        is_muted=case when coalesce(p_disabled,false) then true else is_muted end,
        updated_at=clock_timestamp()
    where room_id=p_room_id
      and user_id=p_target_user_id
      and status='joined';
  elsif p_source='camera' then
    update public.conference_participants
    set camera_publishing_disabled=coalesce(p_disabled,false),
        is_video_off=case when coalesce(p_disabled,false) then true else is_video_off end,
        updated_at=clock_timestamp()
    where room_id=p_room_id
      and user_id=p_target_user_id
      and status='joined';
  else
    update public.conference_participants
    set screen_publishing_disabled=coalesce(p_disabled,false),
        updated_at=clock_timestamp()
    where room_id=p_room_id
      and user_id=p_target_user_id
      and status='joined';
  end if;

  if not found then
    return jsonb_build_object('ok',false,'reason','participant_not_found');
  end if;

  v_policy:=private.conference_livekit_policy_for_user(
    p_room_id,p_target_user_id
  );

  insert into public.conference_audit_events(
    room_id,actor_user_id,target_user_id,event_type,metadata
  )
  values(
    p_room_id,
    auth.uid(),
    p_target_user_id,
    'participant_publish_permission_changed',
    jsonb_build_object(
      'source',p_source,
      'disabled',coalesce(p_disabled,false)
    )
  );

  return jsonb_build_object(
    'ok',true,
    'source',p_source,
    'disabled',coalesce(p_disabled,false),
    'livekit_policy',v_policy
  );
end;
$$;

create or replace function public.set_livekit_participant_media_permission(
  p_room_id uuid,
  p_target_user_id uuid,
  p_source text,
  p_disabled boolean
)
returns jsonb
language sql
set search_path=''
as $$
  select private.set_livekit_participant_media_permission(
    p_room_id,p_target_user_id,p_source,p_disabled
  )
$$;

revoke all on function public.set_livekit_participant_media_permission(
  uuid,uuid,text,boolean
) from public,anon;

grant execute on function public.set_livekit_participant_media_permission(
  uuid,uuid,text,boolean
) to authenticated,service_role;

drop function if exists public.get_conference_participants_rbac(uuid);

create function public.get_conference_participants_rbac(
  p_room_id uuid
)
returns table(
  user_id uuid,
  display_name text,
  role text,
  is_muted boolean,
  is_hand_raised boolean,
  hand_raised_at timestamptz,
  status text,
  mic_publishing_disabled boolean,
  camera_publishing_disabled boolean,
  screen_publishing_disabled boolean
)
language sql
stable
set search_path=''
as $$
  select
    p.user_id,
    p.display_name,
    private.conference_effective_role(p_room_id,p.user_id),
    p.is_muted,
    p.is_hand_raised,
    p.hand_raised_at,
    p.status,
    p.mic_publishing_disabled,
    p.camera_publishing_disabled,
    p.screen_publishing_disabled
  from public.conference_participants p
  where p.room_id=p_room_id and p.status='joined'
  order by p.hand_raised_at asc nulls last,p.joined_at asc nulls last
$$;

revoke all on function public.get_conference_participants_rbac(uuid)
  from public,anon;
grant execute on function public.get_conference_participants_rbac(uuid)
  to authenticated,service_role;
