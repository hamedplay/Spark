create or replace function private.conference_room_lock_blocks_current_user(
  p_room_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_locked boolean:=false;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return true;
  end if;

  select r.is_locked
  into v_locked
  from public.conference_rooms r
  where r.id=p_room_id;

  if not found or not coalesce(v_locked,false) then
    return false;
  end if;

  if private.has_conference_permission(
    p_room_id,'LOCK_ROOM',v_uid
  ) then
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function private.conference_room_lock_blocks_current_user(uuid)
from public,anon;
grant execute on function private.conference_room_lock_blocks_current_user(uuid)
to authenticated,service_role;

create or replace function public.check_conference_join(p_room_id uuid)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select case
    when not private.conference_api_session_is_full() then
      jsonb_build_object('allowed',false,'reason','not_authorized')
    when private.conference_room_lock_blocks_current_user(p_room_id) then
      jsonb_build_object('allowed',false,'reason','room_locked')
    else private.check_conference_join(p_room_id)
  end
$function$;

create or replace function public.join_conference_room(
  p_room_id uuid,
  p_peer_id text,
  p_display_name text,
  p_is_muted boolean default false,
  p_is_video_off boolean default false
)
returns jsonb
language sql
set search_path to ''
as $function$
  select case
    when not private.conference_api_session_is_full() then
      jsonb_build_object('allowed',false,'reason','not_authorized')
    when private.conference_room_lock_blocks_current_user(p_room_id) then
      jsonb_build_object('allowed',false,'reason','room_locked')
    else private.join_conference_authenticated(
      p_room_id,p_peer_id,p_display_name,p_is_muted,p_is_video_off
    )
  end
$function$;

create or replace function public.prepare_livekit_conference_join(p_room_id uuid)
returns jsonb
language sql
set search_path to ''
as $function$
  select case
    when not private.conference_api_session_is_full() then
      jsonb_build_object('ok',false,'reason','not_authorized')
    when private.conference_room_lock_blocks_current_user(p_room_id) then
      jsonb_build_object('ok',false,'reason','room_locked')
    else private.prepare_livekit_conference_join_phase21(p_room_id)
  end
$function$;
