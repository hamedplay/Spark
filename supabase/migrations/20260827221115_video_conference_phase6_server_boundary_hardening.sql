create or replace function private.guard_conference_phase_columns()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if current_user in ('anon','authenticated') then
    raise exception using
      errcode='42501',
      message='conference phase state is server managed';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_conference_phase_columns()
from public,anon,authenticated;
grant execute on function private.guard_conference_phase_columns()
to service_role;

drop trigger if exists conference_rooms_phase_server_guard
on public.conference_rooms;

create trigger conference_rooms_phase_server_guard
before update of
  current_phase,
  phase_started_at,
  phase_ends_at,
  phase_revision,
  phase_allow_mic,
  phase_allow_camera,
  phase_allow_chat
on public.conference_rooms
for each row
execute function private.guard_conference_phase_columns();

create or replace function private.enforce_conference_phase_chat_insert()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_chat_enabled boolean;
  v_phase_allow_chat boolean;
  v_status text;
begin
  select r.chat_enabled,r.phase_allow_chat,r.status
  into v_chat_enabled,v_phase_allow_chat,v_status
  from public.conference_rooms r
  where r.id=new.room_id;

  if not found then
    raise exception using
      errcode='23503',
      message='conference room not found';
  end if;

  if v_status='ended'
     or not coalesce(v_chat_enabled,false)
     or not coalesce(v_phase_allow_chat,false) then
    raise exception using
      errcode='42501',
      message='conference chat is disabled for the current meeting phase';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_conference_phase_chat_insert()
from public,anon,authenticated;
grant execute on function private.enforce_conference_phase_chat_insert()
to service_role;

drop trigger if exists conference_messages_phase_chat_guard
on public.conference_messages;

create trigger conference_messages_phase_chat_guard
before insert on public.conference_messages
for each row
execute function private.enforce_conference_phase_chat_insert();

notify pgrst,'reload schema';
