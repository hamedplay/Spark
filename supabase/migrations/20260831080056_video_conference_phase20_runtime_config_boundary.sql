
create or replace function private.get_video_conference_runtime_config_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_topology text := 'mesh';
  v_max integer := 6;
  v_mesh_max integer := 6;
  v_ttl integer := 8;
  v_recording boolean := false;
  v_waiting boolean := false;
  v_chat boolean := true;
  v_reactions boolean := true;
  v_screen_share boolean := true;
begin
  if not private.conference_api_session_is_full() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select case
    when lower(coalesce(value,'mesh'))='sfu' then 'sfu'
    else 'mesh'
  end
  into v_topology
  from public.system_config
  where section='video_conference' and key='media_topology';
  v_topology:=coalesce(v_topology,'mesh');

  select greatest(
    2,
    least(20,coalesce(nullif(value,'')::integer,6))
  )
  into v_max
  from public.system_config
  where section='video_conference' and key='max_participants';
  v_max:=coalesce(v_max,6);

  select greatest(
    2,
    least(6,coalesce(nullif(value,'')::integer,6))
  )
  into v_mesh_max
  from public.system_config
  where section='video_conference' and key='mesh_max_participants';
  v_mesh_max:=coalesce(v_mesh_max,6);

  select greatest(
    1,
    least(72,coalesce(nullif(value,'')::integer,8))
  )
  into v_ttl
  from public.system_config
  where section='video_conference' and key='room_default_ttl_hours';
  v_ttl:=coalesce(v_ttl,8);

  select coalesce(nullif(value,'')::boolean,false)
  into v_recording
  from public.system_config
  where section='video_conference' and key='recording_enabled';
  v_recording:=coalesce(v_recording,false);

  select coalesce(nullif(value,'')::boolean,false)
  into v_waiting
  from public.system_config
  where section='video_conference' and key='default_waiting_room';
  v_waiting:=coalesce(v_waiting,false);

  select coalesce(nullif(value,'')::boolean,true)
  into v_chat
  from public.system_config
  where section='video_conference' and key='default_allow_chat';
  v_chat:=coalesce(v_chat,true);

  select coalesce(nullif(value,'')::boolean,true)
  into v_reactions
  from public.system_config
  where section='video_conference' and key='default_allow_reactions';
  v_reactions:=coalesce(v_reactions,true);

  select coalesce(nullif(value,'')::boolean,true)
  into v_screen_share
  from public.system_config
  where section='video_conference' and key='default_allow_screen_share';
  v_screen_share:=coalesce(v_screen_share,true);

  return jsonb_build_object(
    'ok',true,
    'media_topology',v_topology,
    'max_participants',
      case when v_topology='mesh'
        then least(v_max,v_mesh_max,6)
        else v_max
      end,
    'configured_max_participants',v_max,
    'mesh_max_participants',v_mesh_max,
    'room_default_ttl_hours',v_ttl,
    'recording_enabled',v_recording,
    'default_waiting_room',v_waiting,
    'default_allow_chat',v_chat,
    'default_allow_reactions',v_reactions,
    'default_allow_screen_share',v_screen_share
  );
end;
$$;

revoke all
on function private.get_video_conference_runtime_config_v1()
from public,anon;
grant execute
on function private.get_video_conference_runtime_config_v1()
to authenticated,service_role;

create or replace function public.get_video_conference_runtime_config()
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select private.get_video_conference_runtime_config_v1()
$$;

revoke all
on function public.get_video_conference_runtime_config()
from public,anon;
grant execute
on function public.get_video_conference_runtime_config()
to authenticated,service_role;

comment on function public.get_video_conference_runtime_config() is
  'Phase 20 invoker API wrapper; privileged system_config reads remain in a private FULL-auth guarded helper.';
