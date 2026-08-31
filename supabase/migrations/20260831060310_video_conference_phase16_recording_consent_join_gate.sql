
create or replace function private.prepare_livekit_conference_join(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_room public.conference_rooms%rowtype;
  v_role text;
  v_display_name text:='';
  v_joined_count integer;
  v_waiting_status text;
  v_meeting_allowed boolean:=false;
  v_recording_active boolean:=false;
  v_consent_ok boolean:=false;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select * into v_room
  from public.conference_rooms
  where id=p_room_id
  for update;

  if not found or v_room.media_topology<>'sfu' or v_room.livekit_room_name is null then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if v_room.status='ended' or (v_room.expires_at is not null and v_room.expires_at<=now()) then
    return jsonb_build_object('ok',false,'reason','room_ended');
  end if;

  if v_room.is_locked and v_room.host_id<>v_uid then
    return jsonb_build_object('ok',false,'reason','room_locked');
  end if;

  if exists(
    select 1 from public.banned_users b
    where b.room_id=p_room_id
      and b.user_id=v_uid
      and (b.expires_at is null or b.expires_at>now())
  ) then
    return jsonb_build_object('ok',false,'reason','banned');
  end if;

  if v_room.meeting_id is not null then
    select exists(
      select 1 from public.meetings m
      where m.id=v_room.meeting_id
        and (
          m.user_id=v_uid
          or m.meeting_manager=v_uid
          or v_uid=any(coalesce(m.participant_user_ids,'{}'::uuid[]))
        )
    ) into v_meeting_allowed;
  else
    v_meeting_allowed:=v_room.host_id=v_uid or exists(
      select 1 from public.conference_participants p
      where p.room_id=p_room_id and p.user_id=v_uid
    );
  end if;

  if not v_meeting_allowed then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  if not private.has_conference_permission(p_room_id,'JOIN_ROOM',v_uid) then
    return jsonb_build_object('ok',false,'reason','permission_denied');
  end if;

  if v_room.host_id=v_uid then
    v_role:='host';
  else
    select p.role,p.display_name into v_role,v_display_name
    from public.conference_participants p
    where p.room_id=p_room_id and p.user_id=v_uid;

    if v_role not in ('admin','moderator') then
      v_role:='member';
    end if;
  end if;

  if (v_room.waiting_room_enabled or v_room.require_approval) and v_room.host_id<>v_uid then
    select w.status into v_waiting_status
    from public.conference_waiting_room w
    where w.room_id=p_room_id and w.user_id=v_uid
    order by w.requested_at desc
    limit 1;

    if v_waiting_status is distinct from 'admitted' then
      if v_waiting_status is null then
        insert into public.conference_waiting_room(
          room_id,user_id,display_name,status,requested_at
        )
        values(
          p_room_id,v_uid,coalesce(v_display_name,''),'waiting',now()
        );
      elsif v_waiting_status='rejected' then
        return jsonb_build_object('ok',false,'reason','rejected');
      end if;

      return jsonb_build_object('ok',false,'reason','waiting_for_admission');
    end if;
  end if;

  select count(*) into v_joined_count
  from public.conference_participants p
  where p.room_id=p_room_id
    and p.status='joined'
    and p.user_id<>v_uid;

  if v_joined_count>=least(v_room.max_participants,20) then
    return jsonb_build_object('ok',false,'reason','room_full');
  end if;

  select exists(
    select 1
    from public.conference_recordings r
    where r.room_id=p_room_id
      and r.status in ('queued','starting','recording','stopping','processing')
  ) into v_recording_active;

  if v_recording_active and coalesce(v_room.recording_consent_required,true) then
    select exists(
      select 1
      from public.conference_recording_consents c
      where c.room_id=p_room_id
        and c.user_id=v_uid
        and c.status='accepted'
        and c.policy_version=1
    ) into v_consent_ok;

    if not v_consent_ok then
      return jsonb_build_object(
        'ok',false,
        'reason','recording_consent_required',
        'recording_active',true,
        'consent_policy_version',1
      );
    end if;
  end if;

  insert into public.conference_participants(
    room_id,user_id,display_name,role,status,joined_at,left_at,peer_id,last_seen
  )
  values(
    p_room_id,v_uid,coalesce(v_display_name,''),coalesce(v_role,'member'),
    'joined',now(),null,'',now()
  )
  on conflict(room_id,user_id) do update
  set role=excluded.role,
      status='joined',
      joined_at=now(),
      left_at=null,
      last_seen=now();

  insert into public.conference_audit_events(room_id,actor_user_id,event_type)
  values(p_room_id,v_uid,'participant_joined');

  return jsonb_build_object(
    'ok',true,
    'reason','ok',
    'room_id',v_room.id,
    'meeting_id',v_room.meeting_id,
    'livekit_room_name',v_room.livekit_room_name,
    'role',coalesce(v_role,'member'),
    'rbac_role',private.conference_effective_role(p_room_id,v_uid),
    'display_name',coalesce(v_display_name,''),
    'max_participants',least(v_room.max_participants,20)
  );
end;
$$;
