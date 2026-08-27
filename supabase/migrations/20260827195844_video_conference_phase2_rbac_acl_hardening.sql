create or replace function private.join_conference_authenticated(
  p_room_id uuid,
  p_peer_id text,
  p_display_name text,
  p_is_muted boolean default false,
  p_is_video_off boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid;
  v_room public.conference_rooms%rowtype;
  v_count int;
  v_role text;
  v_rbac_role text;
begin
  v_uid:=auth.uid();
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('allowed',false,'reason','not_authenticated');
  end if;

  select * into v_room from public.conference_rooms where id=p_room_id for update;
  if not found then return jsonb_build_object('allowed',false,'reason','room_not_found'); end if;
  if v_room.status='ended' or (v_room.expires_at is not null and v_room.expires_at<=now()) then
    return jsonb_build_object('allowed',false,'reason','room_ended');
  end if;
  if v_room.is_locked then return jsonb_build_object('allowed',false,'reason','room_locked'); end if;
  if exists(
    select 1 from public.banned_users b
    where b.room_id=p_room_id and b.user_id=v_uid
      and (b.expires_at is null or b.expires_at>now())
  ) then
    return jsonb_build_object('allowed',false,'reason','banned');
  end if;

  v_rbac_role:=private.conference_effective_role(p_room_id,v_uid);
  if v_rbac_role is null and v_room.meeting_id is null then
    v_rbac_role:='PARTICIPANT';
  end if;

  if v_rbac_role is null or not exists(
    select 1 from private.conference_role_permissions rp
    where rp.role=v_rbac_role and rp.permission='JOIN_ROOM'
  ) then
    return jsonb_build_object('allowed',false,'reason','permission_denied');
  end if;

  select p.role into v_role
  from public.conference_participants p
  where p.room_id=p_room_id and p.user_id=v_uid;

  if v_room.host_id=v_uid then
    v_role:='host';
  elsif v_role not in ('admin','moderator') then
    v_role:='member';
  end if;

  if v_room.media_topology='sfu' and v_room.livekit_room_name is not null then
    return jsonb_build_object(
      'allowed',true,'reason','sfu_token_gate',
      'role',coalesce(v_role,'member'),'rbac_role',v_rbac_role
    );
  end if;

  select count(*) into v_count
  from public.conference_participants p
  where p.room_id=p_room_id and p.status='joined' and p.user_id<>v_uid;

  if v_count>=least(v_room.max_participants,6) then
    return jsonb_build_object('allowed',false,'reason','room_full');
  end if;

  insert into public.conference_participants(
    room_id,user_id,display_name,role,status,joined_at,left_at,
    is_muted,is_video_off,peer_id,last_seen
  )
  values(
    p_room_id,v_uid,left(trim(p_display_name),60),coalesce(v_role,'member'),
    'joined',now(),null,coalesce(p_is_muted,false),coalesce(p_is_video_off,false),
    left(coalesce(p_peer_id,''),200),now()
  )
  on conflict(room_id,user_id) do update
  set display_name=excluded.display_name,role=excluded.role,status='joined',
      joined_at=now(),left_at=null,is_muted=excluded.is_muted,
      is_video_off=excluded.is_video_off,peer_id=excluded.peer_id,last_seen=now();

  return jsonb_build_object(
    'allowed',true,'reason','ok',
    'role',coalesce(v_role,'member'),'rbac_role',v_rbac_role
  );
end;
$$;

drop policy if exists "auth_can_join_rooms" on public.conference_participants;
create policy "auth_can_join_rooms"
on public.conference_participants
for insert
to authenticated
with check (
  (select auth.uid())=user_id
  and (
    (
      role='host'
      and exists(
        select 1 from public.conference_rooms r
        where r.id=conference_participants.room_id
          and r.host_id=(select auth.uid())
      )
    )
    or (
      role='member'
      and private.has_conference_permission(room_id,'JOIN_ROOM')
    )
  )
);

revoke execute on function private.set_conference_participant_role(uuid,uuid,text) from public,anon;
revoke execute on function private.admit_livekit_conference_participant(uuid,uuid,boolean) from public,anon;
revoke execute on function private.set_livekit_room_lock(uuid,boolean) from public,anon;
revoke execute on function private.moderate_conference_participant(uuid,uuid,text) from public,anon;
revoke execute on function private.ban_conference_participant(uuid,uuid,text,integer,text) from public,anon;
revoke execute on function private.set_conference_chat_enabled(uuid,boolean) from public,anon;
revoke execute on function private.clear_conference_whiteboard(uuid) from public,anon;
revoke execute on function private.mute_all_conference_participants(uuid) from public,anon;
revoke execute on function private.set_conference_participant_speaking_limit(uuid,uuid,integer) from public,anon;
revoke execute on function private.set_conference_speaking_limit_enabled(uuid,boolean) from public,anon;
revoke execute on function private.set_conference_pinned_user(uuid,uuid) from public,anon;
revoke execute on function private.create_conference_breakouts(uuid,text[]) from public,anon;
revoke execute on function private.end_conference_breakouts(uuid) from public,anon;
revoke execute on function private.end_conference_room(uuid,text) from public,anon;
revoke execute on function private.transfer_conference_host(uuid,uuid) from public,anon;
revoke execute on function private.prepare_livekit_conference_join(uuid) from public,anon;
revoke execute on function private.join_conference_authenticated(uuid,text,text,boolean,boolean) from public,anon;
revoke execute on function private.authorize_livekit_host_action(uuid,uuid,text) from public,anon;
revoke execute on function private.authorize_livekit_recording(uuid,text) from public,anon;

grant execute on function private.set_conference_participant_role(uuid,uuid,text) to authenticated,service_role;
grant execute on function private.admit_livekit_conference_participant(uuid,uuid,boolean) to authenticated,service_role;
grant execute on function private.set_livekit_room_lock(uuid,boolean) to authenticated,service_role;
grant execute on function private.moderate_conference_participant(uuid,uuid,text) to authenticated,service_role;
grant execute on function private.ban_conference_participant(uuid,uuid,text,integer,text) to authenticated,service_role;
grant execute on function private.set_conference_chat_enabled(uuid,boolean) to authenticated,service_role;
grant execute on function private.clear_conference_whiteboard(uuid) to authenticated,service_role;
grant execute on function private.mute_all_conference_participants(uuid) to authenticated,service_role;
grant execute on function private.set_conference_participant_speaking_limit(uuid,uuid,integer) to authenticated,service_role;
grant execute on function private.set_conference_speaking_limit_enabled(uuid,boolean) to authenticated,service_role;
grant execute on function private.set_conference_pinned_user(uuid,uuid) to authenticated,service_role;
grant execute on function private.create_conference_breakouts(uuid,text[]) to authenticated,service_role;
grant execute on function private.end_conference_breakouts(uuid) to authenticated,service_role;
grant execute on function private.end_conference_room(uuid,text) to authenticated,service_role;
grant execute on function private.transfer_conference_host(uuid,uuid) to authenticated,service_role;
grant execute on function private.prepare_livekit_conference_join(uuid) to authenticated,service_role;
grant execute on function private.join_conference_authenticated(uuid,text,text,boolean,boolean) to authenticated,service_role;
grant execute on function private.authorize_livekit_host_action(uuid,uuid,text) to authenticated,service_role;
grant execute on function private.authorize_livekit_recording(uuid,text) to authenticated,service_role;

revoke execute on function public.authorize_livekit_host_action(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.authorize_livekit_recording(uuid) from public,anon,authenticated;
grant execute on function public.authorize_livekit_host_action(uuid,uuid) to service_role;
grant execute on function public.authorize_livekit_recording(uuid) to service_role;

revoke execute on function private.authorize_livekit_host_action(uuid,uuid) from public,anon,authenticated;
revoke execute on function private.authorize_livekit_recording(uuid) from public,anon,authenticated;
grant execute on function private.authorize_livekit_host_action(uuid,uuid) to service_role;
grant execute on function private.authorize_livekit_recording(uuid) to service_role;

notify pgrst,'reload schema';
