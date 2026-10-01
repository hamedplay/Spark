-- Temporarily disable video-conference creation while keeping existing rooms/data intact.
-- Re-enable later by setting system_config(video_conference, enabled) to 'true'.

create or replace function public.is_video_conference_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select lower(btrim(sc.value)) = 'true'
      from public.system_config sc
      where sc.section = 'video_conference'
        and sc.key = 'enabled'
      limit 1
    ),
    false
  );
$$;

create or replace function private.block_conference_room_creation_when_disabled_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_video_conference_enabled() then
    raise exception using
      errcode = 'P0001',
      message = 'VIDEO_CONFERENCE_DISABLED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_conference_room_creation_when_disabled on public.conference_rooms;
create trigger trg_block_conference_room_creation_when_disabled
before insert on public.conference_rooms
for each row
execute function private.block_conference_room_creation_when_disabled_v1();

insert into public.system_config (
  section,
  key,
  value,
  value_type,
  label,
  description,
  updated_at
)
values (
  'video_conference',
  'enabled',
  'false',
  'boolean',
  'ویدئوکنفرانس',
  'فعال یا غیرفعال بودن ایجاد اتاق ویدئوکنفرانس',
  now()
)
on conflict (section, key) do update
set value = excluded.value,
    value_type = excluded.value_type,
    updated_at = now();
