-- Persist per-user removal of a meeting from the personal calendar without
-- changing the meeting itself or the participant/observer relationship.

create table if not exists public.meeting_calendar_exclusions (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

alter table public.meeting_calendar_exclusions enable row level security;

drop policy if exists "Users can read own meeting calendar exclusions" on public.meeting_calendar_exclusions;
create policy "Users can read own meeting calendar exclusions"
on public.meeting_calendar_exclusions
for select
to authenticated
using (auth.uid() = user_id);

grant select on public.meeting_calendar_exclusions to authenticated;

create or replace function private.remove_self_from_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_subject text;
  v_authorized boolean := false;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select
    m.subject,
    (
      m.user_id = v_user_id
      or m.meeting_manager = v_user_id
      or v_user_id = any(coalesce(m.participant_user_ids, '{}'::uuid[]))
      or v_user_id = any(coalesce(m.notify_users, '{}'::uuid[]))
      or exists (
        select 1
        from public.meeting_inbox mi
        where mi.meeting_id = m.id
          and mi.user_id = v_user_id
      )
      or exists (
        select 1
        from public.calendar_subscriptions cs
        where cs.calendar_id = m.calendar_id
          and cs.user_id = v_user_id
      )
    )
  into v_subject, v_authorized
  from public.meetings m
  where m.id = p_meeting_id;

  if not found then
    raise exception 'MEETING_NOT_FOUND';
  end if;

  if not coalesce(v_authorized, false) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  insert into public.meeting_calendar_exclusions (meeting_id, user_id, hidden_at)
  values (p_meeting_id, v_user_id, now())
  on conflict (meeting_id, user_id)
  do update set hidden_at = excluded.hidden_at;

  insert into public.audit_log (
    user_id,
    module,
    entity_name,
    entity_id,
    action,
    details,
    severity,
    created_at
  )
  values (
    v_user_id,
    'calendar',
    coalesce(v_subject, 'meeting'),
    p_meeting_id::text,
    'remove_from_personal_calendar',
    'Meeting removed from the current user personal calendar only',
    'info',
    now()
  );
end;
$function$;

create or replace function public.remove_self_from_meeting(p_meeting_id uuid)
returns void
language sql
set search_path = ''
as $function$
  select private.remove_self_from_meeting($1::uuid)
$function$;

grant execute on function public.remove_self_from_meeting(uuid) to authenticated;

-- A normal meeting edit must not restore a hidden meeting. Only a newly-added
-- participant/observer/manager relationship is treated as an explicit re-invite.
create or replace function private.clear_calendar_exclusion_on_meeting_reinvite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_old_ids uuid[];
  v_new_ids uuid[];
begin
  v_old_ids := array(
    select distinct x
    from unnest(
      coalesce(old.participant_user_ids, '{}'::uuid[])
      || coalesce(old.notify_users, '{}'::uuid[])
      || case when old.meeting_manager is null then '{}'::uuid[] else array[old.meeting_manager] end
    ) as t(x)
    where x is not null
  );

  v_new_ids := array(
    select distinct x
    from unnest(
      coalesce(new.participant_user_ids, '{}'::uuid[])
      || coalesce(new.notify_users, '{}'::uuid[])
      || case when new.meeting_manager is null then '{}'::uuid[] else array[new.meeting_manager] end
    ) as t(x)
    where x is not null
  );

  for v_user_id in
    select x from unnest(v_new_ids) as n(x)
    except
    select x from unnest(v_old_ids) as o(x)
  loop
    delete from public.meeting_calendar_exclusions
    where meeting_id = new.id
      and user_id = v_user_id;
  end loop;

  return new;
end;
$function$;

drop trigger if exists clear_calendar_exclusion_on_meeting_reinvite on public.meetings;
create trigger clear_calendar_exclusion_on_meeting_reinvite
after update of participant_user_ids, notify_users, meeting_manager
on public.meetings
for each row
execute function private.clear_calendar_exclusion_on_meeting_reinvite();

-- Some invitation flows re-use an existing meeting_inbox row and explicitly
-- transition it back to pending. That is also a genuine re-invite.
create or replace function private.clear_calendar_exclusion_on_inbox_reinvite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.meeting_id is not null
     and new.status = 'pending'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    delete from public.meeting_calendar_exclusions
    where meeting_id = new.meeting_id
      and user_id = new.user_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists clear_calendar_exclusion_on_inbox_reinvite on public.meeting_inbox;
create trigger clear_calendar_exclusion_on_inbox_reinvite
after insert or update of status
on public.meeting_inbox
for each row
execute function private.clear_calendar_exclusion_on_inbox_reinvite();
