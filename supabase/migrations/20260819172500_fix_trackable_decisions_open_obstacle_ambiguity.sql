-- Fix PL/pgSQL output-column ambiguity in the trackable decisions query.
-- The RETURNS TABLE output variable open_obstacle_count conflicts with the CTE column
-- when referenced without a relation alias inside RETURN QUERY.

create or replace function private.get_trackable_minutes_decisions(
  p_search text default null,
  p_meeting_id uuid default null,
  p_owner_user_id uuid default null,
  p_responsible_unit_id uuid default null,
  p_status text default null,
  p_priority text default null,
  p_requires_followup boolean default null,
  p_has_open_obstacle boolean default null,
  p_deadline_state text default null,
  p_start_from date default null,
  p_start_to date default null,
  p_due_from date default null,
  p_due_to date default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table(
  id uuid,
  minute_id uuid,
  title text,
  description text,
  primary_owner_user_id uuid,
  owner_name text,
  responsible_unit_id uuid,
  responsible_unit_name_snapshot text,
  priority text,
  status text,
  progress_percent integer,
  start_date date,
  due_date date,
  completed_at timestamptz,
  requires_followup boolean,
  latest_update text,
  latest_followup_at timestamptz,
  open_obstacle_count integer,
  updated_at timestamptz,
  minute_title text,
  minute_status text,
  meeting_date_snapshot text,
  overdue boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tehran')::date;
  v_dl text := lower(coalesce(p_deadline_state, 'all'));
  v_week_start date;
  v_week_end date;
  v_status_filter text := lower(coalesce(p_status, ''));
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if p_due_from is not null and p_due_to is not null and p_due_from > p_due_to then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;

  if p_start_from is not null and p_start_to is not null and p_start_from > p_start_to then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;

  v_dl := case v_dl
    when 'due_today' then 'today'
    when 'due_soon' then 'approaching'
    when 'on_track' then 'on_time'
    when 'no_due_date' then 'no_deadline'
    else v_dl
  end;

  v_week_start := v_today - (((extract(dow from v_today))::integer + 1) % 7);
  v_week_end := v_week_start + 6;

  return query
  with decision_base as (
    select
      d.id,
      d.minute_id,
      case
        when d.parent_decision_id is not null
          then 'بند ' || coalesce(d.clause_order, 1)::text || ' ـ ' || d.title
        else d.title
      end as title,
      d.description,
      d.primary_owner_user_id,
      d.responsible_unit_id,
      d.responsible_unit_name_snapshot,
      d.priority::text,
      d.status::text,
      d.progress_percent,
      d.start_date,
      d.due_date,
      d.completed_at,
      d.requires_followup,
      d.latest_update,
      d.updated_at,
      m.meeting_title_snapshot,
      m.status::text as minute_status,
      m.meeting_date_snapshot,
      (
        d.due_date is not null
        and d.due_date < v_today
        and d.status not in ('completed', 'stopped')
      ) as overdue
    from public.minutes_decisions d
    join public.minutes m on m.id = d.minute_id
    where public._can_track_decisions(d.minute_id)
      and (
        d.parent_decision_id is not null
        or not exists (
          select 1
          from public.minutes_decisions c
          where c.parent_decision_id = d.id
        )
      )
      and (p_meeting_id is null or d.minute_id = p_meeting_id)
      and (p_owner_user_id is null or d.primary_owner_user_id = p_owner_user_id)
      and (p_responsible_unit_id is null or d.responsible_unit_id = p_responsible_unit_id)
      and (
        v_status_filter = ''
        or (
          v_status_filter = 'active'
          and d.status in ('not_started', 'planned', 'in_progress', 'waiting_coordination', 'waiting_approval')
        )
        or d.status::text = p_status
      )
      and (p_priority is null or d.priority::text = p_priority)
      and (p_requires_followup is null or d.requires_followup = p_requires_followup)
      and (p_start_from is null or d.start_date >= p_start_from)
      and (p_start_to is null or d.start_date <= p_start_to)
      and (p_due_from is null or d.due_date >= p_due_from)
      and (p_due_to is null or d.due_date <= p_due_to)
      and (
        p_search is null
        or p_search = ''
        or d.title ilike '%' || p_search || '%'
        or m.meeting_title_snapshot ilike '%' || p_search || '%'
      )
      and (
        v_dl = 'all'
        or (v_dl = 'overdue' and d.due_date is not null and d.due_date < v_today and d.status not in ('completed', 'stopped'))
        or (v_dl = 'today' and d.due_date = v_today and d.status not in ('completed', 'stopped'))
        or (v_dl = 'this_week' and d.due_date between v_week_start and v_week_end and d.status not in ('completed', 'stopped'))
        or (v_dl = 'next_7_days' and d.due_date between v_today and v_today + 6 and d.status not in ('completed', 'stopped'))
        or (v_dl = 'approaching' and d.due_date > v_today and d.due_date <= v_today + 3 and d.status not in ('completed', 'stopped'))
        or (v_dl = 'on_time' and d.due_date > v_today + 3 and d.status not in ('completed', 'stopped'))
        or (v_dl = 'no_deadline' and d.due_date is null)
        or (v_dl = 'completed' and d.status = 'completed')
      )
  ), enriched as (
    select
      db.*,
      coalesce(p.full_name, p.username, db.primary_owner_user_id::text) as owner_name,
      (
        select max(u.created_at)
        from public.minutes_decision_updates u
        where u.decision_id = db.id
          and u.event_type = 'followup'
      ) as latest_followup_at,
      (
        select count(*)::integer
        from public.minutes_decision_updates u
        where u.decision_id = db.id
          and u.event_type = 'obstacle'
          and u.is_blocking = true
          and u.resolved_at is null
      ) as open_obstacle_count
    from decision_base db
    left join public.profiles_public p on p.user_id = db.primary_owner_user_id
  ), filtered as (
    select e.*
    from enriched e
    where p_has_open_obstacle is null
       or p_has_open_obstacle = false
       or e.open_obstacle_count > 0
  ), counted as (
    select count(*) cnt
    from filtered
  )
  select
    f.id,
    f.minute_id,
    f.title,
    f.description,
    f.primary_owner_user_id,
    f.owner_name,
    f.responsible_unit_id,
    f.responsible_unit_name_snapshot,
    f.priority,
    f.status,
    f.progress_percent,
    f.start_date,
    f.due_date,
    f.completed_at,
    f.requires_followup,
    f.latest_update,
    f.latest_followup_at,
    f.open_obstacle_count,
    f.updated_at,
    f.meeting_title_snapshot,
    f.minute_status,
    f.meeting_date_snapshot,
    f.overdue,
    c.cnt::bigint
  from filtered f
  cross join counted c
  order by
    f.overdue desc,
    case when f.due_date = v_today then 0 else 1 end,
    case when f.due_date is not null and f.due_date <= v_today + 3 then 0 else 1 end,
    case f.priority
      when 'urgent' then 1
      when 'important' then 2
      when 'normal' then 3
      when 'low' then 4
      else 5
    end,
    f.due_date asc nulls last,
    f.updated_at desc
  limit p_limit
  offset p_offset;
end;
$$;
