
alter table public.conference_participants
  add column if not exists livekit_rejoin_blocked_until timestamptz;

comment on column public.conference_participants.livekit_rejoin_blocked_until is
  'Phase 21 self-hosted LiveKit fresh-token reissue cooldown after moderator removal.';

create or replace function private.moderate_conference_participant_phase21(
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
  v_result jsonb;
begin
  v_result:=private.moderate_conference_participant(
    p_room_id,
    p_target_user_id,
    p_action
  );

  if p_action='kick'
     and coalesce((v_result->>'ok')::boolean,false) then
    update public.conference_participants
    set livekit_rejoin_blocked_until=
          greatest(
            coalesce(livekit_rejoin_blocked_until,'-infinity'::timestamptz),
            clock_timestamp()+interval '2 minutes'
          ),
        updated_at=clock_timestamp()
    where room_id=p_room_id
      and user_id=p_target_user_id;
  end if;

  return v_result;
end;
$$;

revoke all on function private.moderate_conference_participant_phase21(
  uuid,uuid,text
) from public,anon;
grant execute on function private.moderate_conference_participant_phase21(
  uuid,uuid,text
) to authenticated,service_role;

create or replace function public.moderate_conference_participant(
  p_room_id uuid,
  p_target_user_id uuid,
  p_action text
)
returns jsonb
language sql
set search_path=''
as $$
  select private.moderate_conference_participant_phase21(
    p_room_id,
    p_target_user_id,
    p_action
  )
$$;

revoke all on function public.moderate_conference_participant(
  uuid,uuid,text
) from public,anon;
grant execute on function public.moderate_conference_participant(
  uuid,uuid,text
) to authenticated,service_role;

create or replace function private.prepare_livekit_conference_join_phase21(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_blocked_until timestamptz;
  v_retry_after integer;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select p.livekit_rejoin_blocked_until
  into v_blocked_until
  from public.conference_participants p
  where p.room_id=p_room_id
    and p.user_id=v_uid;

  if v_blocked_until is not null
     and v_blocked_until>clock_timestamp() then
    v_retry_after:=greatest(
      1,
      ceil(extract(
        epoch from (v_blocked_until-clock_timestamp())
      ))::integer
    );

    return jsonb_build_object(
      'ok',false,
      'reason','rejoin_blocked',
      'retry_after_seconds',v_retry_after,
      'blocked_until',v_blocked_until
    );
  end if;

  return private.prepare_livekit_conference_join(p_room_id);
end;
$$;

revoke all on function private.prepare_livekit_conference_join_phase21(uuid)
from public,anon;
grant execute on function private.prepare_livekit_conference_join_phase21(uuid)
to authenticated,service_role;

create or replace function public.prepare_livekit_conference_join(
  p_room_id uuid
)
returns jsonb
language sql
set search_path=''
as $$
  select case
    when private.conference_api_session_is_full()
      then private.prepare_livekit_conference_join_phase21(p_room_id)
    else jsonb_build_object('ok',false,'reason','not_authorized')
  end
$$;

revoke all on function public.prepare_livekit_conference_join(uuid)
from public,anon;
grant execute on function public.prepare_livekit_conference_join(uuid)
to authenticated,service_role;

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
       or new.livekit_rejoin_blocked_until is distinct from old.livekit_rejoin_blocked_until
     ) then
    raise exception 'conference_participant_sensitive_update_forbidden'
      using errcode='42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_conference_participant_client_update()
from public,anon,authenticated;

comment on function private.prepare_livekit_conference_join_phase21(uuid) is
  'Phase 21 blocks fresh self-hosted LiveKit token issuance during the short replay window after moderator removal.';
