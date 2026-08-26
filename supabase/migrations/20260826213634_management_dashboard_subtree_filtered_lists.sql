create or replace function public.get_management_minutes_v1(
  p_search text default null,
  p_status text default null,
  p_view text default 'all',
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_total integer;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_view text := coalesce(nullif(btrim(p_view), ''), 'all');
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_dashboard') then
    raise exception 'MANAGEMENT_DASHBOARD_FORBIDDEN' using errcode = '42501';
  end if;
  if v_view not in ('all', 'draft', 'pending_approval') then
    raise exception 'INVALID_MANAGEMENT_MINUTE_VIEW' using errcode = '22023';
  end if;

  with scoped_units as (
    select scoped_unit_id from private.get_management_scope_units_v1(v_uid)
  ),
  scoped_users as (
    select scoped_user_id from private.get_management_scope_users_v1(v_uid)
  ),
  base as (
    select distinct
      m.id,
      m.meeting_id,
      m.meeting_title_snapshot,
      m.meeting_date_snapshot,
      m.meeting_start_time_snapshot,
      m.org_unit_id,
      coalesce(nullif(btrim(ou.name), ''), nullif(btrim(m.org_unit_name_snapshot), ''), 'بدون واحد') as unit_name,
      m.secretary_name_snapshot,
      m.chair_name_snapshot,
      m.status,
      m.revision_number,
      m.created_at,
      m.updated_at
    from public.minutes m
    left join public.org_units ou on ou.id = m.org_unit_id
    where (
      m.org_unit_id in (select scoped_unit_id from scoped_units)
      or exists (
        select 1
        from public.minutes_decisions d
        where d.minute_id = m.id
          and (
            d.responsible_unit_id in (select scoped_unit_id from scoped_units)
            or d.primary_owner_user_id in (select scoped_user_id from scoped_users)
          )
      )
    )
      and (p_status is null or p_status = '' or m.status = p_status)
      and (
        v_view = 'all'
        or (v_view = 'draft' and m.status = 'draft')
        or (v_view = 'pending_approval' and m.status = 'pending_approval')
      )
      and (
        p_search is null or btrim(p_search) = ''
        or coalesce(m.meeting_title_snapshot, '') ilike '%' || p_search || '%'
        or coalesce(m.org_unit_name_snapshot, '') ilike '%' || p_search || '%'
      )
  ),
  counted as (
    select count(*)::integer as c from base
  ),
  page as (
    select *
    from base
    order by meeting_date_snapshot desc nulls last, updated_at desc
    limit v_limit offset v_offset
  )
  select
    coalesce(jsonb_agg(to_jsonb(page) order by meeting_date_snapshot desc nulls last, updated_at desc), '[]'::jsonb),
    (select c from counted)
  into v_rows, v_total
  from page;

  return jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb), 'total_count', coalesce(v_total, 0));
end;
$$;

revoke all on function public.get_management_minutes_v1(text,text,text,integer,integer) from public, anon;
grant execute on function public.get_management_minutes_v1(text,text,text,integer,integer) to authenticated;

create or replace function public.get_management_decisions_v3(
  p_search text default null,
  p_status text default null,
  p_unit_id uuid default null,
  p_owner_user_id uuid default null,
  p_view text default 'all',
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_total integer;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_view text := coalesce(nullif(btrim(p_view), ''), 'all');
  v_today date := (timezone('Asia/Tehran', now()))::date;
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_decisions.view') then
    raise exception 'MANAGEMENT_DECISIONS_FORBIDDEN' using errcode = '42501';
  end if;
  if v_view not in ('all', 'active', 'overdue', 'near_deadline') then
    raise exception 'INVALID_MANAGEMENT_DECISION_VIEW' using errcode = '22023';
  end if;

  with scoped_units as (
    select scoped_unit_id from private.get_management_scope_units_v1(v_uid)
  ),
  scoped_users as (
    select scoped_user_id from private.get_management_scope_users_v1(v_uid)
  ),
  base as (
    select
      d.id,
      d.parent_decision_id,
      coalesce(d.parent_decision_id, d.id) as decision_group_id,
      d.minute_id,
      d.title,
      d.description,
      d.status,
      d.progress_percent,
      d.priority,
      d.start_date,
      d.due_date,
      d.completed_at,
      d.requires_followup,
      d.latest_update,
      d.primary_owner_user_id,
      coalesce(pp.full_name, pp.username, d.primary_owner_user_id::text) as owner_name,
      d.responsible_unit_id,
      coalesce(nullif(btrim(ou.name), ''), nullif(btrim(d.responsible_unit_name_snapshot), ''), 'بدون واحد') as unit_name,
      m.meeting_title_snapshot as minute_title,
      m.meeting_date_snapshot,
      d.created_at,
      d.updated_at,
      (d.due_date is not null and d.due_date < v_today and d.status not in ('completed', 'stopped')) as overdue,
      (select count(*)::integer
         from public.minutes_decision_updates u
        where u.decision_id = d.id
          and u.event_type = 'obstacle'
          and u.is_blocking = true
          and u.resolved_at is null) as open_obstacle_count
    from public.minutes_decisions d
    join public.minutes m on m.id = d.minute_id
    left join public.org_units ou on ou.id = d.responsible_unit_id
    left join public.profiles pp on pp.user_id = d.primary_owner_user_id
    where (
      d.parent_decision_id is not null
      or not exists (select 1 from public.minutes_decisions c where c.parent_decision_id = d.id)
    )
      and (
        d.responsible_unit_id in (select scoped_unit_id from scoped_units)
        or d.primary_owner_user_id in (select scoped_user_id from scoped_users)
        or m.org_unit_id in (select scoped_unit_id from scoped_units)
      )
      and (p_status is null or p_status = '' or d.status = p_status)
      and (p_unit_id is null or d.responsible_unit_id = p_unit_id)
      and (p_owner_user_id is null or d.primary_owner_user_id = p_owner_user_id)
      and (
        v_view = 'all'
        or (v_view = 'active' and d.status in ('not_started', 'planned', 'in_progress', 'waiting_coordination', 'waiting_approval'))
        or (v_view = 'overdue' and d.due_date is not null and d.due_date < v_today and d.status not in ('completed', 'stopped'))
        or (v_view = 'near_deadline' and d.due_date between v_today and v_today + 7 and d.status not in ('completed', 'stopped'))
      )
      and (
        p_search is null or btrim(p_search) = ''
        or d.title ilike '%' || p_search || '%'
        or coalesce(d.description, '') ilike '%' || p_search || '%'
        or coalesce(m.meeting_title_snapshot, '') ilike '%' || p_search || '%'
      )
  ),
  counted as (
    select count(*)::integer as c from base
  ),
  page as (
    select *
    from base
    order by overdue desc, due_date asc nulls last, updated_at desc
    limit v_limit offset v_offset
  )
  select
    coalesce(jsonb_agg(to_jsonb(page) order by overdue desc, due_date asc nulls last, updated_at desc), '[]'::jsonb),
    (select c from counted)
  into v_rows, v_total
  from page;

  return jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb), 'total_count', coalesce(v_total, 0));
end;
$$;

revoke all on function public.get_management_decisions_v3(text,text,uuid,uuid,text,integer,integer) from public, anon;
grant execute on function public.get_management_decisions_v3(text,text,uuid,uuid,text,integer,integer) to authenticated;

create or replace function public.get_management_tasks_v2(
  p_search text default null,
  p_status text default null,
  p_assignee_user_id uuid default null,
  p_view text default 'all',
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_total integer;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_view text := coalesce(nullif(btrim(p_view), ''), 'all');
  v_today date := (timezone('Asia/Tehran', now()))::date;
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_tasks.view') then
    raise exception 'MANAGEMENT_TASKS_FORBIDDEN' using errcode = '42501';
  end if;
  if v_view not in ('all', 'today', 'in_progress', 'completed', 'overdue', 'urgent') then
    raise exception 'INVALID_MANAGEMENT_TASK_VIEW' using errcode = '22023';
  end if;

  with scoped_users as (
    select scoped_user_id from private.get_management_scope_users_v1(v_uid)
  ),
  source as (
    select
      t.id,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.due_date,
      t.start_date,
      t.progress_percent,
      t.assignee,
      t.current_assignee_id,
      coalesce(p.full_name, p.username, t.assignee) as assignee_name,
      t.user_id,
      t.created_by_id,
      t.archived,
      t.tags,
      t.parent_task_id,
      t.created_at,
      case
        when t.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          then (t.due_date::timestamptz at time zone 'Asia/Tehran')::date
        else null
      end as due_local_date
    from public.tasks t
    left join public.profiles p on p.user_id = t.current_assignee_id
    where coalesce(t.archived, false) = false
      and (
        t.current_assignee_id in (select scoped_user_id from scoped_users)
        or (t.current_assignee_id is null and t.user_id in (select scoped_user_id from scoped_users))
      )
      and (p_status is null or p_status = '' or t.status = p_status)
      and (p_assignee_user_id is null or t.current_assignee_id = p_assignee_user_id)
      and (
        p_search is null or btrim(p_search) = ''
        or t.title ilike '%' || p_search || '%'
        or coalesce(t.description, '') ilike '%' || p_search || '%'
      )
  ),
  base as (
    select *
    from source s
    where
      v_view = 'all'
      or (v_view = 'today' and s.due_local_date = v_today)
      or (v_view = 'in_progress' and s.status = 'in_progress')
      or (v_view = 'completed' and s.status = 'completed')
      or (v_view = 'overdue' and s.status <> 'completed' and s.due_local_date is not null and s.due_local_date < v_today)
      or (v_view = 'urgent' and s.priority = 'high' and s.status <> 'completed')
  ),
  counted as (
    select count(*)::integer as c from base
  ),
  page as (
    select *
    from base
    order by due_local_date asc nulls last, created_at desc
    limit v_limit offset v_offset
  )
  select
    coalesce(jsonb_agg(to_jsonb(page) order by due_local_date asc nulls last, created_at desc), '[]'::jsonb),
    (select c from counted)
  into v_rows, v_total
  from page;

  return jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb), 'total_count', coalesce(v_total, 0));
end;
$$;

revoke all on function public.get_management_tasks_v2(text,text,uuid,text,integer,integer) from public, anon;
grant execute on function public.get_management_tasks_v2(text,text,uuid,text,integer,integer) to authenticated;

notify pgrst, 'reload schema';
