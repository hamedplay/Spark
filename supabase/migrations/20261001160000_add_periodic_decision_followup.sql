-- Periodic agenda follow-up for minutes decisions.
-- Reuses the existing minutes reminder worker/outbox pipeline.

alter table public.minutes_decisions
  add column if not exists followup_recurrence text not null default 'none',
  add column if not exists followup_recipient_type text not null default 'secretary',
  add column if not exists next_periodic_followup_at timestamptz;

alter table public.minutes_decisions
  drop constraint if exists minutes_decisions_followup_recurrence_check,
  add constraint minutes_decisions_followup_recurrence_check
    check (followup_recurrence in ('none', 'weekly', 'monthly')),
  drop constraint if exists minutes_decisions_followup_recipient_type_check,
  add constraint minutes_decisions_followup_recipient_type_check
    check (followup_recipient_type in ('secretary', 'owner'));

create index if not exists idx_minutes_decisions_periodic_followup_due
  on public.minutes_decisions (next_periodic_followup_at)
  where followup_recurrence <> 'none'
    and status not in ('completed', 'stopped');

alter table public.minutes_decision_reminders
  add column if not exists recurrence_cycle_at timestamptz,
  add column if not exists recipient_type text;

alter table public.minutes_decision_reminders
  drop constraint if exists minutes_decision_reminders_recipient_type_check,
  add constraint minutes_decision_reminders_recipient_type_check
    check (recipient_type is null or recipient_type in ('secretary', 'owner'));

create unique index if not exists uniq_periodic_reminder_per_decision_cycle
  on public.minutes_decision_reminders (decision_id, recurrence_cycle_at)
  where recurrence_cycle_at is not null;

-- Preserve the mature decision sync implementation and wrap it so the new
-- fields can evolve independently without copying the large legacy body.
alter function public._sync_minutes_decisions(uuid, jsonb, uuid[])
  rename to _sync_minutes_decisions_legacy_periodic_v1;

create function public._sync_minutes_decisions(
  p_minute_id uuid,
  p_decisions jsonb,
  p_deleted_decision_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_dec jsonb;
  v_decision_id uuid;
  v_recurrence text;
  v_recipient_type text;
  v_old_recurrence text;
  v_old_recipient_type text;
  v_owner_id uuid;
begin
  v_result := public._sync_minutes_decisions_legacy_periodic_v1(
    p_minute_id,
    p_decisions,
    p_deleted_decision_ids
  );

  for v_dec in select value from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) loop
    if not (v_dec ? 'followup_recurrence') then
      continue;
    end if;

    v_decision_id := nullif(v_dec->>'id', '')::uuid;
    if v_decision_id is null then
      continue;
    end if;

    v_recurrence := coalesce(nullif(v_dec->>'followup_recurrence', ''), 'none');
    v_recipient_type := coalesce(nullif(v_dec->>'followup_recipient_type', ''), 'secretary');

    if v_recurrence not in ('none', 'weekly', 'monthly') then
      raise exception 'INVALID_FOLLOWUP_RECURRENCE' using errcode = 'P0001';
    end if;
    if v_recipient_type not in ('secretary', 'owner') then
      raise exception 'INVALID_FOLLOWUP_RECIPIENT' using errcode = 'P0001';
    end if;

    select d.followup_recurrence, d.followup_recipient_type, d.primary_owner_user_id
      into v_old_recurrence, v_old_recipient_type, v_owner_id
    from public.minutes_decisions d
    where d.id = v_decision_id
      and d.minute_id = p_minute_id
    for update;

    if not found then
      continue;
    end if;

    if v_recurrence <> 'none' and v_recipient_type = 'owner' and v_owner_id is null then
      raise exception 'NO_PERIODIC_FOLLOWUP_RECIPIENT' using errcode = 'P0001';
    end if;

    if v_old_recurrence is distinct from v_recurrence
       or v_old_recipient_type is distinct from v_recipient_type then
      update public.minutes_decision_reminders r
         set status = 'cancelled',
             cancelled_at = coalesce(r.cancelled_at, now()),
             updated_at = now()
       where r.decision_id = v_decision_id
         and r.recurrence_cycle_at is not null
         and r.status in ('pending', 'processing');
    end if;

    update public.minutes_decisions d
       set followup_recurrence = v_recurrence,
           followup_recipient_type = v_recipient_type,
           next_periodic_followup_at = case
             when v_recurrence = 'none' then null
             when v_old_recurrence is distinct from v_recurrence
               or v_old_recipient_type is distinct from v_recipient_type then null
             else d.next_periodic_followup_at
           end,
           requires_followup = case
             when v_recurrence <> 'none' then true
             else d.requires_followup
           end,
           updated_at = now()
     where d.id = v_decision_id
       and d.minute_id = p_minute_id;
  end loop;

  return v_result;
end;
$$;

revoke all on function public._sync_minutes_decisions(uuid, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public._sync_minutes_decisions(uuid, jsonb, uuid[]) to service_role;

-- Read-only helper used by the minutes edit UI. Keeping this separate avoids
-- changing the established get_minutes_decisions_for_edit return contract.
create or replace function public.get_minutes_decision_periodic_settings(p_decision_ids uuid[])
returns table(
  decision_id uuid,
  followup_recurrence text,
  followup_recipient_type text,
  next_periodic_followup_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id,
         d.followup_recurrence,
         d.followup_recipient_type,
         d.next_periodic_followup_at
    from public.minutes_decisions d
   where d.id = any(coalesce(p_decision_ids, '{}'::uuid[]))
     and public._user_can_view_minute(d.minute_id)
$$;

revoke all on function public.get_minutes_decision_periodic_settings(uuid[]) from public, anon;
grant execute on function public.get_minutes_decision_periodic_settings(uuid[]) to authenticated, service_role;

-- Materialize at most one due reminder per decision on each worker pass and
-- advance the cursor directly to the next future cycle. This prevents a burst
-- of old reminders after downtime while retaining a stable cycle key.
create or replace function public.materialize_due_minutes_periodic_reminders(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_recipient uuid;
  v_next timestamptz;
  v_created integer := 0;
begin
  -- Closed/stopped decisions must never emit reminders, including legacy
  -- one-shot reminders that were still pending at the time of closure.
  update public.minutes_decision_reminders r
     set status = 'cancelled',
         cancelled_at = coalesce(r.cancelled_at, now()),
         updated_at = now()
    from public.minutes_decisions d
   where d.id = r.decision_id
     and d.status in ('completed', 'stopped')
     and r.status in ('pending', 'processing');

  update public.minutes_decisions d
     set next_periodic_followup_at = null,
         updated_at = now()
   where (d.followup_recurrence = 'none' or d.status in ('completed', 'stopped'))
     and d.next_periodic_followup_at is not null;

  -- Initialize the recurrence cursor only after the minute is published.
  update public.minutes_decisions d
     set next_periodic_followup_at = case d.followup_recurrence
           when 'weekly' then m.published_at + interval '7 days'
           when 'monthly' then m.published_at + interval '1 month'
           else null
         end,
         updated_at = now()
    from public.minutes m
   where m.id = d.minute_id
     and m.status = 'published'
     and m.published_at is not null
     and d.followup_recurrence in ('weekly', 'monthly')
     and d.status not in ('completed', 'stopped')
     and d.next_periodic_followup_at is null;

  for v_row in
    select d.id as decision_id,
           d.minute_id,
           d.primary_owner_user_id,
           d.followup_recurrence,
           d.followup_recipient_type,
           d.next_periodic_followup_at,
           d.created_by_user_id,
           m.secretary_user_id
      from public.minutes_decisions d
      join public.minutes m on m.id = d.minute_id
     where d.followup_recurrence in ('weekly', 'monthly')
       and d.status not in ('completed', 'stopped')
       and d.next_periodic_followup_at is not null
       and d.next_periodic_followup_at <= now()
       and m.status = 'published'
       and m.published_at is not null
       and (d.parent_decision_id is not null or not exists (
         select 1 from public.minutes_decisions c where c.parent_decision_id = d.id
       ))
     order by d.next_periodic_followup_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update of d skip locked
  loop
    v_recipient := case v_row.followup_recipient_type
      when 'owner' then v_row.primary_owner_user_id
      else v_row.secretary_user_id
    end;

    -- Safety fallback for historical/inconsistent rows. New UI validation does
    -- not allow owner delivery when there is no internal owner.
    if v_recipient is null then
      v_recipient := v_row.secretary_user_id;
    end if;

    if v_recipient is not null then
      insert into public.minutes_decision_reminders (
        decision_id,
        minute_id,
        recipient_user_id,
        remind_at,
        status,
        created_by_user_id,
        recurrence_cycle_at,
        recipient_type
      ) values (
        v_row.decision_id,
        v_row.minute_id,
        v_recipient,
        v_row.next_periodic_followup_at,
        'pending',
        v_row.created_by_user_id,
        v_row.next_periodic_followup_at,
        v_row.followup_recipient_type
      )
      on conflict (decision_id, recurrence_cycle_at)
        where recurrence_cycle_at is not null
      do nothing;

      if found then
        v_created := v_created + 1;
      end if;
    end if;

    v_next := v_row.next_periodic_followup_at;
    loop
      v_next := case v_row.followup_recurrence
        when 'weekly' then v_next + interval '7 days'
        else v_next + interval '1 month'
      end;
      exit when v_next > now();
    end loop;

    update public.minutes_decisions
       set next_periodic_followup_at = v_next,
           updated_at = now()
     where id = v_row.decision_id;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.materialize_due_minutes_periodic_reminders(integer) from public, anon, authenticated;
grant execute on function public.materialize_due_minutes_periodic_reminders(integer) to service_role;

-- Return periodic metadata to the existing worker and block all reminders for
-- decisions that have since been closed/stopped.
drop function public.claim_due_minutes_decision_reminders(integer);

create function public.claim_due_minutes_decision_reminders(p_limit integer default 50)
returns table(
  id uuid,
  decision_id uuid,
  minute_id uuid,
  recipient_user_id uuid,
  decision_title text,
  recurrence_cycle_at timestamptz,
  recipient_type text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stuck_threshold timestamptz := now() - interval '10 minutes';
  v_claimed_ids uuid[];
begin
  select array_agg(sub.rid) into v_claimed_ids
  from (
    select r.id as rid
      from public.minutes_decision_reminders r
      join public.minutes_decisions d on d.id = r.decision_id
      join public.minutes m on m.id = d.minute_id
     where ((r.status = 'pending' and r.remind_at <= now())
         or (r.status = 'processing' and r.updated_at < v_stuck_threshold))
       and d.status not in ('completed', 'stopped')
       and m.status = 'published'
       and m.published_at is not null
       and (d.parent_decision_id is not null or not exists (
         select 1 from public.minutes_decisions c where c.parent_decision_id = d.id
       ))
     order by r.remind_at asc
     limit least(greatest(coalesce(p_limit, 50), 1), 100)
     for update of r skip locked
  ) sub;

  if v_claimed_ids is null or array_length(v_claimed_ids, 1) is null then
    return;
  end if;

  update public.minutes_decision_reminders r
     set status = 'processing', updated_at = now()
   where r.id = any(v_claimed_ids);

  return query
  select r.id,
         r.decision_id,
         r.minute_id,
         r.recipient_user_id,
         d.title,
         r.recurrence_cycle_at,
         r.recipient_type
    from public.minutes_decision_reminders r
    join public.minutes_decisions d on d.id = r.decision_id
    join public.minutes m on m.id = d.minute_id
   where r.id = any(v_claimed_ids)
     and d.status not in ('completed', 'stopped')
     and m.status = 'published'
     and m.published_at is not null
     and (d.parent_decision_id is not null or not exists (
       select 1 from public.minutes_decisions c where c.parent_decision_id = d.id
     ))
   order by r.remind_at asc;
end;
$$;

revoke all on function public.claim_due_minutes_decision_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_minutes_decision_reminders(integer) to service_role;
