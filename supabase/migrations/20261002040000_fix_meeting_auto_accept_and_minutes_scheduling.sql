-- Fix remaining meeting/minutes integration gaps:
-- 1) user-configurable direct-invite auto-accept
-- 2) immediate cancellation of periodic reminders when a decision terminates
-- 3) suppress already-queued scheduled notifications when an admin disables a schedule

create table if not exists public.user_auto_accept_organizers (
  user_id uuid not null references auth.users(id) on delete cascade,
  organizer_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, organizer_user_id),
  constraint user_auto_accept_organizers_no_self check (user_id <> organizer_user_id)
);

alter table public.user_auto_accept_organizers enable row level security;

revoke all on table public.user_auto_accept_organizers from public;
grant select, insert, delete on table public.user_auto_accept_organizers to authenticated;

drop policy if exists user_auto_accept_organizers_select_own on public.user_auto_accept_organizers;
create policy user_auto_accept_organizers_select_own
  on public.user_auto_accept_organizers
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_auto_accept_organizers_insert_own on public.user_auto_accept_organizers;
create policy user_auto_accept_organizers_insert_own
  on public.user_auto_accept_organizers
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_auto_accept_organizers_delete_own on public.user_auto_accept_organizers;
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

drop trigger if exists trg_auto_accept_direct_meeting_invite_insert on public.meeting_inbox;
create trigger trg_auto_accept_direct_meeting_invite_insert
before insert on public.meeting_inbox
for each row
execute function private.auto_accept_direct_meeting_invite_v1();

drop trigger if exists trg_auto_accept_direct_meeting_invite_update on public.meeting_inbox;
create trigger trg_auto_accept_direct_meeting_invite_update
before update of status, delegate_to, delegated_by_user_id on public.meeting_inbox
for each row
execute function private.auto_accept_direct_meeting_invite_v1();

create or replace function private.cancel_decision_scheduled_delivery_when_terminal_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status in ('completed', 'stopped')
     and old.status is distinct from new.status then
    new.next_periodic_followup_at := null;

    update public.minutes_decision_reminders r
       set status = 'cancelled',
           cancelled_at = coalesce(r.cancelled_at, now()),
           updated_at = now()
     where r.decision_id = new.id
       and r.status in ('pending', 'processing', 'queued');

    update public.notification_outbox o
       set status = 'processed',
           processed_at = coalesce(o.processed_at, now()),
           next_attempt_at = null,
           last_error = 'DECISION_TERMINAL'
     where o.entity_type = 'decision'
       and o.entity_id = new.id
       and o.event_type = 'decision_followup_due'
       and o.processed_at is null
       and o.status in ('pending', 'processing', 'partial');
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_cancel_decision_scheduled_delivery_when_terminal on public.minutes_decisions;
create trigger trg_cancel_decision_scheduled_delivery_when_terminal
before update of status on public.minutes_decisions
for each row
execute function private.cancel_decision_scheduled_delivery_when_terminal_v1();

create or replace function private.suppress_disabled_minutes_schedule_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_disabled boolean;
begin
  if new.section <> 'minutes'
     or new.key not in (
       'decision_due_schedule_enabled',
       'periodic_followup_schedule_enabled'
     ) then
    return new;
  end if;

  v_disabled := lower(btrim(coalesce(new.value, 'true'))) = 'false';
  if not v_disabled then
    return new;
  end if;

  if new.key = 'periodic_followup_schedule_enabled' then
    update public.minutes_decision_reminders r
       set status = 'cancelled',
           cancelled_at = coalesce(r.cancelled_at, now()),
           updated_at = now()
     where r.recurrence_cycle_at is not null
       and r.status in ('pending', 'processing', 'queued');

    update public.notification_outbox o
       set status = 'processed',
           processed_at = coalesce(o.processed_at, now()),
           next_attempt_at = null,
           last_error = 'SCHEDULE_DISABLED'
     where o.event_type = 'decision_followup_due'
       and coalesce((o.payload->'context'->>'periodic_followup')::boolean, false) = true
       and o.processed_at is null
       and o.status in ('pending', 'processing', 'partial');
  else
    update public.notification_outbox o
       set status = 'processed',
           processed_at = coalesce(o.processed_at, now()),
           next_attempt_at = null,
           last_error = 'SCHEDULE_DISABLED'
     where o.event_type in ('decision_due_soon', 'decision_overdue')
       and o.processed_at is null
       and o.status in ('pending', 'processing', 'partial');
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_suppress_disabled_minutes_schedule_insert on public.system_config;
create trigger trg_suppress_disabled_minutes_schedule_insert
after insert on public.system_config
for each row
execute function private.suppress_disabled_minutes_schedule_v1();

drop trigger if exists trg_suppress_disabled_minutes_schedule_update on public.system_config;
create trigger trg_suppress_disabled_minutes_schedule_update
after update of value on public.system_config
for each row
when (old.value is distinct from new.value)
execute function private.suppress_disabled_minutes_schedule_v1();
