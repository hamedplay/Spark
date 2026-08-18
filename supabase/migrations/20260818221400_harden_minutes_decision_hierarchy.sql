-- Harden multi-clause decision hierarchy invariants.
-- 1) Parent/child depth is exactly one level even for direct Data API writes.
-- 2) Parent aggregate status/progress is refreshed when a child is deleted.
-- 3) Deadline/reminder workers operate only on executable rows: clauses + standalone parents.

create or replace function private._validate_minutes_decision_hierarchy_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_parent_id uuid;
  v_parent_minute_id uuid;
begin
  if new.parent_decision_id is null then
    return new;
  end if;

  if new.parent_decision_id = new.id then
    raise exception 'INVALID_DECISION_CLAUSE' using errcode = 'P0001';
  end if;

  select p.parent_decision_id, p.minute_id
    into v_parent_parent_id, v_parent_minute_id
  from public.minutes_decisions p
  where p.id = new.parent_decision_id;

  if not found then
    raise exception 'DECISION_PARENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_parent_minute_id is distinct from new.minute_id then
    raise exception 'DECISION_PARENT_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  if v_parent_parent_id is not null then
    raise exception 'NESTED_DECISION_CLAUSES_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  -- A row that already owns clauses cannot itself be converted into a clause.
  if exists (
    select 1
    from public.minutes_decisions c
    where c.parent_decision_id = new.id
  ) then
    raise exception 'NESTED_DECISION_CLAUSES_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private._validate_minutes_decision_hierarchy_trigger() from public, anon, authenticated;

drop trigger if exists tr_minutes_validate_decision_hierarchy on public.minutes_decisions;
create trigger tr_minutes_validate_decision_hierarchy
before insert or update of parent_decision_id, minute_id
on public.minutes_decisions
for each row execute function private._validate_minutes_decision_hierarchy_trigger();

create or replace function private._minutes_clause_refresh_parent_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.parent_decision_id is not null then
      perform private._refresh_minutes_parent_decision(old.parent_decision_id);
    end if;
    return old;
  end if;

  if new.parent_decision_id is not null then
    perform private._refresh_minutes_parent_decision(new.parent_decision_id);
  end if;

  if tg_op = 'UPDATE'
     and old.parent_decision_id is distinct from new.parent_decision_id
     and old.parent_decision_id is not null then
    perform private._refresh_minutes_parent_decision(old.parent_decision_id);
  end if;

  return new;
end;
$$;

revoke all on function private._minutes_clause_refresh_parent_trigger() from public, anon, authenticated;

drop trigger if exists tr_minutes_clause_refresh_parent on public.minutes_decisions;
create trigger tr_minutes_clause_refresh_parent
after insert or delete or update of status, progress_percent, completed_at, latest_update, parent_decision_id
on public.minutes_decisions
for each row execute function private._minutes_clause_refresh_parent_trigger();

create or replace function public.claim_due_minutes_decision_reminders(p_limit integer default 50)
returns table(id uuid, decision_id uuid, minute_id uuid, recipient_user_id uuid, decision_title text)
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
    where (
      (r.status = 'pending' and r.remind_at <= now())
      or (r.status = 'processing' and r.updated_at < v_stuck_threshold)
    )
      and m.status = 'published'
      and m.published_at is not null
      and (
        d.parent_decision_id is not null
        or not exists (
          select 1 from public.minutes_decisions c where c.parent_decision_id = d.id
        )
      )
    order by r.remind_at asc
    limit least(p_limit, 100)
    for update of r skip locked
  ) sub;

  if v_claimed_ids is null or array_length(v_claimed_ids, 1) is null then
    return;
  end if;

  update public.minutes_decision_reminders r
  set status = 'processing', updated_at = now()
  where r.id = any(v_claimed_ids);

  return query
  select r.id, r.decision_id, r.minute_id, r.recipient_user_id, d.title
  from public.minutes_decision_reminders r
  join public.minutes_decisions d on d.id = r.decision_id
  join public.minutes m on m.id = d.minute_id
  where r.id = any(v_claimed_ids)
    and m.status = 'published'
    and m.published_at is not null
    and (
      d.parent_decision_id is not null
      or not exists (
        select 1 from public.minutes_decisions c where c.parent_decision_id = d.id
      )
    )
  order by r.remind_at asc;
end;
$$;

create or replace function public.claim_due_overdue_decisions(p_lead_days integer default 1)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tehran')::date;
  v_due_soon_date date := v_today + p_lead_days;
  v_idempotency text;
  v_context jsonb;
  v_rec record;
begin
  for v_rec in
    select d.id as decision_id, d.primary_owner_user_id, d.title, d.due_date,
           d.minute_id, m.meeting_title_snapshot as minute_title
    from public.minutes_decisions d
    join public.minutes m on m.id = d.minute_id
    where d.status not in ('completed', 'stopped')
      and d.primary_owner_user_id is not null
      and d.due_date = v_due_soon_date
      and m.status = 'published'
      and m.published_at is not null
      and (
        d.parent_decision_id is not null
        or not exists (
          select 1 from public.minutes_decisions c where c.parent_decision_id = d.id
        )
      )
  loop
    v_idempotency := 'decision:' || v_rec.decision_id::text || ':decision_due_soon:' || v_today::text || ':' || v_rec.primary_owner_user_id::text;
    v_context := jsonb_build_object(
      'decision_title', v_rec.title,
      'decision_due_date', v_rec.due_date::text,
      'minute_title', coalesce(v_rec.minute_title, ''),
      'decision_link', '#minutes-my-decisions?decision=' || v_rec.decision_id::text,
      'audience', 'decision_owner'
    );
    perform public.resolve_and_queue_notification(
      'decision_due_soon', v_rec.primary_owner_user_id, 'decision_owner',
      'decision', v_rec.decision_id, v_rec.minute_id, null, v_context, v_idempotency, null
    );
  end loop;

  for v_rec in
    select d.id as decision_id, d.primary_owner_user_id, d.title, d.due_date,
           d.minute_id, m.meeting_title_snapshot as minute_title
    from public.minutes_decisions d
    join public.minutes m on m.id = d.minute_id
    where d.status not in ('completed', 'stopped')
      and d.primary_owner_user_id is not null
      and d.due_date < v_today
      and m.status = 'published'
      and m.published_at is not null
      and (
        d.parent_decision_id is not null
        or not exists (
          select 1 from public.minutes_decisions c where c.parent_decision_id = d.id
        )
      )
  loop
    v_idempotency := 'decision:' || v_rec.decision_id::text || ':decision_overdue:' || v_today::text || ':' || v_rec.primary_owner_user_id::text;
    v_context := jsonb_build_object(
      'decision_title', v_rec.title,
      'decision_due_date', v_rec.due_date::text,
      'minute_title', coalesce(v_rec.minute_title, ''),
      'decision_link', '#minutes-my-decisions?decision=' || v_rec.decision_id::text,
      'audience', 'decision_owner'
    );
    perform public.resolve_and_queue_notification(
      'decision_overdue', v_rec.primary_owner_user_id, 'decision_owner',
      'decision', v_rec.decision_id, v_rec.minute_id, null, v_context, v_idempotency, null
    );
  end loop;
end;
$$;

-- Preserve the existing worker ACLs: these functions are scheduler/service operations.
revoke all on function public.claim_due_minutes_decision_reminders(integer) from public, anon, authenticated;
revoke all on function public.claim_due_overdue_decisions(integer) from public, anon, authenticated;
grant execute on function public.claim_due_minutes_decision_reminders(integer) to service_role;
grant execute on function public.claim_due_overdue_decisions(integer) to service_role;
