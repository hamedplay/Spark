
create or replace function private.conference_api_session_is_full()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    auth.uid() is not null
    and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    and private.is_current_session_fully_authorized()
$$;

revoke all on function private.conference_api_session_is_full()
  from public,anon;
grant execute on function private.conference_api_session_is_full()
  to authenticated,service_role;

create or replace function private.conference_effective_role(
  p_room_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_host_id uuid;
  v_meeting_id uuid;
  v_role text;
begin
  if p_user_id is null then
    return null;
  end if;

  if auth.uid() is not null
     and p_user_id=auth.uid()
     and not private.conference_api_session_is_full() then
    return null;
  end if;

  select r.host_id,r.meeting_id
  into v_host_id,v_meeting_id
  from public.conference_rooms r
  where r.id=p_room_id;

  if not found then
    return null;
  end if;

  if v_host_id=p_user_id then
    return 'OWNER';
  end if;

  select a.role
  into v_role
  from private.conference_role_assignments a
  where a.room_id=p_room_id and a.user_id=p_user_id;

  if v_role is not null then
    return v_role;
  end if;

  select private.normalize_conference_rbac_role(p.role)
  into v_role
  from public.conference_participants p
  where p.room_id=p_room_id and p.user_id=p_user_id
  limit 1;

  if v_role is not null then
    return v_role;
  end if;

  if v_meeting_id is not null and exists(
    select 1
    from public.meetings m
    where m.id=v_meeting_id and (
      m.user_id=p_user_id
      or m.meeting_manager=p_user_id
      or p_user_id=any(coalesce(m.participant_user_ids,'{}'::uuid[]))
    )
  ) then
    return 'PARTICIPANT';
  end if;

  return null;
end;
$$;

create or replace function private.conference_actor_role(
  p_room_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
begin
  if not private.conference_api_session_is_full() then
    return null;
  end if;

  if exists(
    select 1
    from public.conference_rooms r
    where r.id=p_room_id and r.host_id=auth.uid()
  ) then
    return 'host';
  end if;

  select p.role
  into v_role
  from public.conference_participants p
  where p.room_id=p_room_id
    and p.user_id=auth.uid()
    and p.status='joined'
  limit 1;

  return v_role;
end;
$$;

create or replace function public.resolve_conference_room(
  p_code text
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.resolve_conference_room_by_code(p_code)
    else null
  end
$$;

create or replace function public.check_conference_join(
  p_room_id uuid
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.check_conference_join(p_room_id)
    else jsonb_build_object('allowed',false,'reason','not_authorized')
  end
$$;

create or replace function public.create_conference_room(
  p_name text default null,
  p_require_approval boolean default false
)
returns jsonb
language sql
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.create_conference_room(p_name,p_require_approval)
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

create or replace function public.create_meeting_livekit_conference(
  p_meeting_id uuid
)
returns jsonb
language sql
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.create_meeting_livekit_conference(p_meeting_id)
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

create or replace function public.join_conference_room(
  p_room_id uuid,
  p_peer_id text,
  p_display_name text,
  p_is_muted boolean default false,
  p_is_video_off boolean default false
)
returns jsonb
language sql
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.join_conference_authenticated(
        p_room_id,p_peer_id,p_display_name,p_is_muted,p_is_video_off
      )
    else jsonb_build_object('allowed',false,'reason','not_authorized')
  end
$$;

create or replace function public.prepare_livekit_conference_join(
  p_room_id uuid
)
returns jsonb
language sql
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.prepare_livekit_conference_join(p_room_id)
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

create or replace function public.get_livekit_waiting_room_state(
  p_room_id uuid
)
returns jsonb
language sql
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.get_livekit_waiting_room_state(p_room_id)
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

create or replace function public.get_livekit_waiting_room_snapshot(
  p_room_id uuid
)
returns jsonb
language sql
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.get_livekit_waiting_room_snapshot(p_room_id)
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

create or replace function public.get_conference_recording_consent_state(
  p_room_id uuid
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.get_conference_recording_consent_state(p_room_id)
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

create or replace function public.set_conference_recording_consent(
  p_room_id uuid,
  p_consented boolean
)
returns jsonb
language sql
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.set_conference_recording_consent(p_room_id,p_consented)
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

create or replace function public.get_conference_phase_snapshot(
  p_room_id uuid
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.get_conference_phase_snapshot(p_room_id)
    else jsonb_build_object(
      'ok',false,
      'reason','not_authorized',
      'server_time',clock_timestamp()
    )
  end
$$;

create or replace function public.get_conference_speaker_timer_snapshot(
  p_room_id uuid
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.get_conference_speaker_timer_snapshot(p_room_id)
    else jsonb_build_object(
      'ok',false,
      'reason','not_authorized',
      'server_time',clock_timestamp(),
      'sessions','[]'::jsonb
    )
  end
$$;

create or replace function public.get_my_conference_authorization(
  p_room_id uuid
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.get_conference_authorization(p_room_id,auth.uid())
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

create or replace function public.get_my_livekit_conference_policy(
  p_room_id uuid
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.conference_livekit_policy(p_room_id)
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

create or replace function public.get_video_conference_runtime_config()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
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

revoke insert,delete,truncate,references,trigger,update
on table public.conference_participants
from authenticated;

grant update(is_muted,is_video_off,is_hand_raised)
on table public.conference_participants
to authenticated;

revoke all
on table public.conference_participants
from anon;

drop policy if exists auth_can_join_rooms
on public.conference_participants;

create or replace function private.guard_conference_participant_client_update()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if current_user in ('authenticated','anon')
     and (
       new.room_id is distinct from old.room_id
       or new.user_id is distinct from old.user_id
       or new.display_name is distinct from old.display_name
       or new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.joined_at is distinct from old.joined_at
       or new.left_at is distinct from old.left_at
       or new.peer_id is distinct from old.peer_id
       or new.speaking_seconds is distinct from old.speaking_seconds
       or new.network_quality is distinct from old.network_quality
       or new.last_seen is distinct from old.last_seen
       or new.speaking_limit_seconds is distinct from old.speaking_limit_seconds
       or new.hand_raised_at is distinct from old.hand_raised_at
       or new.mic_publishing_disabled is distinct from old.mic_publishing_disabled
       or new.camera_publishing_disabled is distinct from old.camera_publishing_disabled
       or new.screen_publishing_disabled is distinct from old.screen_publishing_disabled
     ) then
    raise exception 'conference_participant_sensitive_update_forbidden'
      using errcode='42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_conference_participant_client_update()
from public,anon,authenticated;

drop trigger if exists conference_participant_client_update_guard
on public.conference_participants;

create trigger conference_participant_client_update_guard
before update
on public.conference_participants
for each row
execute function private.guard_conference_participant_client_update();

revoke insert,update,delete,truncate,references,trigger
on table
  public.conference_audit_events,
  public.conference_attendance_events,
  public.conference_message_mentions,
  public.conference_message_reactions,
  public.conference_phase_events,
  public.conference_speaker_sessions
from authenticated;

revoke all
on table public.conference_signals,public.conference_reactions
from anon;

drop policy if exists "Anon can insert signals"
on public.conference_signals;
drop policy if exists "Anon can read signals"
on public.conference_signals;
drop policy if exists "Anon can insert reactions"
on public.conference_reactions;
drop policy if exists "Anon can read reactions"
on public.conference_reactions;

do $$
declare
  v_table text;
  v_policy text;
begin
  foreach v_table in array array[
    'conference_archives',
    'conference_attendance_events',
    'conference_audit_events',
    'conference_breakout_assignments',
    'conference_live_captions',
    'conference_message_mentions',
    'conference_message_reactions',
    'conference_phase_events',
    'conference_preflight_results',
    'conference_recordings',
    'conference_speaker_sessions',
    'conference_transcript_segments',
    'conference_transcripts'
  ]
  loop
    v_policy:=v_table||'_phase20_full_auth_boundary';

    execute format(
      'drop policy if exists %I on public.%I',
      v_policy,
      v_table
    );

    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select private.conference_api_session_is_full())) with check ((select private.conference_api_session_is_full()))',
      v_policy,
      v_table
    );
  end loop;
end
$$;

create or replace function private.can_upload_conference_chat_attachment(
  p_name text,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_parts text[];
  v_room_id uuid;
  v_owner_id uuid;
begin
  if p_user_id is null
     or not private.conference_api_session_is_full() then
    return false;
  end if;

  v_parts:=storage.foldername(p_name);

  if coalesce(array_length(v_parts,1),0)<>3
     or v_parts[1]<>'conf-chat' then
    return false;
  end if;

  begin
    v_room_id:=v_parts[2]::uuid;
    v_owner_id:=v_parts[3]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if v_owner_id<>p_user_id then
    return false;
  end if;

  if not exists(
    select 1
    from public.conference_participants p
    where p.room_id=v_room_id
      and p.user_id=p_user_id
      and p.status='joined'
  ) then
    return false;
  end if;

  if not private.has_conference_permission(
    v_room_id,'SEND_CHAT',p_user_id
  ) then
    return false;
  end if;

  return exists(
    select 1
    from public.conference_rooms r
    where r.id=v_room_id
      and r.status<>'ended'
      and coalesce(r.chat_enabled,false)
      and coalesce(r.phase_allow_chat,true)
  );
end;
$$;

revoke all on function private.can_upload_conference_chat_attachment(text,uuid)
from public,anon;
grant execute on function private.can_upload_conference_chat_attachment(text,uuid)
to authenticated,service_role;

create or replace function private.can_read_conference_chat_attachment_path(
  p_name text,
  p_owner_id text,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_parts text[];
  v_room_id uuid;
begin
  if p_user_id is null
     or not private.conference_api_session_is_full() then
    return false;
  end if;

  v_parts:=storage.foldername(p_name);

  if coalesce(array_length(v_parts,1),0)<>3
     or v_parts[1]<>'conf-chat' then
    return false;
  end if;

  begin
    v_room_id:=v_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if p_owner_id=p_user_id::text and exists(
    select 1
    from public.conference_participants p
    where p.room_id=v_room_id and p.user_id=p_user_id
  ) then
    return true;
  end if;

  return exists(
    select 1
    from public.conference_messages m
    where m.room_id=v_room_id
      and m.image_path=p_name
      and not coalesce(m.is_deleted,false)
      and exists(
        select 1
        from public.conference_participants p
        where p.room_id=v_room_id and p.user_id=p_user_id
      )
  );
end;
$$;

revoke all on function private.can_read_conference_chat_attachment_path(text,text,uuid)
from public,anon;
grant execute on function private.can_read_conference_chat_attachment_path(text,text,uuid)
to authenticated,service_role;

create or replace function private.is_valid_conference_chat_image_path(
  p_room_id uuid,
  p_user_id uuid,
  p_image_path text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_parts text[];
  v_path_room_id uuid;
  v_path_user_id uuid;
begin
  if p_room_id is null
     or p_user_id is null
     or nullif(trim(coalesce(p_image_path,'')),'') is null then
    return false;
  end if;

  v_parts:=storage.foldername(p_image_path);

  if coalesce(array_length(v_parts,1),0)<>3
     or v_parts[1]<>'conf-chat' then
    return false;
  end if;

  begin
    v_path_room_id:=v_parts[2]::uuid;
    v_path_user_id:=v_parts[3]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if v_path_room_id<>p_room_id
     or v_path_user_id<>p_user_id then
    return false;
  end if;

  return exists(
    select 1
    from storage.objects o
    where o.bucket_id='chat-attachments'
      and o.name=p_image_path
      and o.owner_id=p_user_id::text
      and coalesce(o.metadata->>'mimetype','') in (
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif'
      )
  );
end;
$$;

revoke all on function private.is_valid_conference_chat_image_path(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function private.is_valid_conference_chat_image_path(uuid,uuid,text)
to service_role;

drop policy if exists "Conference authenticated upload scoped attachments"
on storage.objects;

create policy "Conference authenticated upload scoped attachments"
on storage.objects
for insert
to authenticated
with check (
  bucket_id='chat-attachments'
  and (storage.foldername(name))[1]='conf-chat'
  and private.can_upload_conference_chat_attachment(
    name,(select auth.uid())
  )
);

drop policy if exists "Conference chat attachment insert boundary"
on storage.objects;

create policy "Conference chat attachment insert boundary"
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id<>'chat-attachments'
  or (storage.foldername(name))[1]<>'conf-chat'
  or private.can_upload_conference_chat_attachment(
    name,(select auth.uid())
  )
);

drop policy if exists "Conference chat attachment read boundary"
on storage.objects;

create policy "Conference chat attachment read boundary"
on storage.objects
as restrictive
for select
to authenticated
using (
  bucket_id<>'chat-attachments'
  or (storage.foldername(name))[1]<>'conf-chat'
  or private.can_read_conference_chat_attachment_path(
    name,owner_id,(select auth.uid())
  )
);

create or replace function private.guard_direct_conference_message_insert()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_db_role text:=current_setting('role',true);
  v_uid uuid:=auth.uid();
  v_allowed jsonb;
  v_rate jsonb;
begin
  if new.image_path is not null
     and not private.is_valid_conference_chat_image_path(
       new.room_id,new.user_id,new.image_path
     ) then
    raise exception 'conference_chat_image_path_invalid'
      using errcode='42501';
  end if;

  if v_db_role<>'authenticated' then
    return new;
  end if;

  if v_uid is null
     or new.user_id<>v_uid
     or not private.conference_api_session_is_full() then
    raise exception 'conference_chat_insert_forbidden'
      using errcode='42501';
  end if;

  v_allowed:=private.conference_chat_action_allowed(
    new.room_id,v_uid,'send',null
  );

  if coalesce((v_allowed->>'ok')::boolean,false) is not true then
    raise exception 'conference_chat_insert_forbidden'
      using errcode='42501';
  end if;

  new.body:=trim(coalesce(new.body,''));

  if char_length(new.body)>4000 then
    raise exception 'conference_chat_message_too_long'
      using errcode='22001';
  end if;

  if new.body=''
     and nullif(trim(coalesce(new.image_path,'')),'') is null then
    raise exception 'conference_chat_message_empty'
      using errcode='22023';
  end if;

  if new.reply_to_id is not null
     or new.reply_to_body is not null
     or new.reply_to_name is not null then
    raise exception 'conference_chat_reply_requires_control_api'
      using errcode='42501';
  end if;

  v_rate:=private.consume_conference_chat_rate_limit(
    new.room_id,v_uid
  );

  if coalesce((v_rate->>'ok')::boolean,false) is not true then
    raise exception 'conference_chat_rate_limited'
      using errcode='P0001';
  end if;

  new.display_name:=private.conference_chat_display_name(
    new.room_id,v_uid
  );
  new.role:=private.conference_chat_role_label(
    new.room_id,v_uid
  );
  new.created_at:=clock_timestamp();
  new.image_url:=null;
  new.is_deleted:=false;
  new.edited_at:=null;
  new.deleted_at:=null;
  new.deleted_by:=null;

  return new;
end;
$$;

revoke all on function private.guard_direct_conference_message_insert()
from public,anon,authenticated;

drop trigger if exists conference_message_direct_insert_guard
on public.conference_messages;

create trigger conference_message_direct_insert_guard
before insert
on public.conference_messages
for each row
execute function private.guard_direct_conference_message_insert();

comment on function private.conference_api_session_is_full() is
  'Phase 20 fail-closed FULL authorization guard for Conference API boundaries.';

comment on trigger conference_participant_client_update_guard
on public.conference_participants is
  'Phase 20 blocks direct client mutation of server-authoritative participant identity, role, lifecycle and LiveKit restriction columns.';

comment on trigger conference_message_direct_insert_guard
on public.conference_messages is
  'Phase 20 preserves legacy simple chat insert while enforcing backend authorization, canonical identity, rate limit and storage path validation.';
