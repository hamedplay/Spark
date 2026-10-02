-- Manual repair asset for meeting auto-accept.
-- This file is NOT a Spark migration and is never executed by Update Supabase.
-- Apply it manually to the PostgreSQL database used by PostgREST, then reload
-- the PostgREST schema cache.

create table if not exists public.user_auto_accept_organizers (
  user_id uuid not null references auth.users(id) on delete cascade,
  organizer_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, organizer_user_id),
  constraint user_auto_accept_organizers_no_self check (user_id <> organizer_user_id)
);

create index if not exists idx_user_auto_accept_organizers_organizer_user_id
  on public.user_auto_accept_organizers (organizer_user_id);

alter table public.user_auto_accept_organizers enable row level security;

revoke all on table public.user_auto_accept_organizers from public;
grant select, insert, delete on table public.user_auto_accept_organizers to authenticated;

drop policy if exists user_auto_accept_organizers_select_own
  on public.user_auto_accept_organizers;
create policy user_auto_accept_organizers_select_own
  on public.user_auto_accept_organizers
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_auto_accept_organizers_insert_own
  on public.user_auto_accept_organizers;
create policy user_auto_accept_organizers_insert_own
  on public.user_auto_accept_organizers
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_auto_accept_organizers_delete_own
  on public.user_auto_accept_organizers;
create policy user_auto_accept_organizers_delete_own
  on public.user_auto_accept_organizers
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function private.auto_accept_direct_meeting_invite_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_organizer uuid;
begin
  if new.meeting_id is null
     or new.status <> 'pending'
     or new.delegated_by_user_id is not null
     or new.delegate_to is not null then
    return new;
  end if;

  select m.user_id
    into v_organizer
    from public.meetings m
   where m.id = new.meeting_id;

  if v_organizer is null then
    return new;
  end if;

  if exists (
    select 1
      from public.user_auto_accept_organizers a
     where a.user_id = new.user_id
       and a.organizer_user_id = v_organizer
  ) then
    new.status := 'accepted';
    new.updated_at := now();

    delete from public.meeting_calendar_exclusions e
     where e.meeting_id = new.meeting_id
       and e.user_id = new.user_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_auto_accept_direct_meeting_invite_insert
  on public.meeting_inbox;
create trigger trg_auto_accept_direct_meeting_invite_insert
before insert on public.meeting_inbox
for each row
execute function private.auto_accept_direct_meeting_invite_v1();

drop trigger if exists trg_auto_accept_direct_meeting_invite_update
  on public.meeting_inbox;
create trigger trg_auto_accept_direct_meeting_invite_update
before update of status, delegate_to, delegated_by_user_id
on public.meeting_inbox
for each row
execute function private.auto_accept_direct_meeting_invite_v1();

notify pgrst, 'reload schema';
