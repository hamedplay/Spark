create or replace function private.management_task_in_scope_v1(
  p_user_id uuid,
  p_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  with scoped_users as (
    select scoped_user_id
    from private.get_management_scope_users_v1(p_user_id)
  )
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and (
        t.current_assignee_id in (select scoped_user_id from scoped_users)
        or (
          t.current_assignee_id is null
          and t.user_id in (select scoped_user_id from scoped_users)
        )
      )
  );
$fn$;

revoke all on function private.management_task_in_scope_v1(uuid, uuid) from public;

create or replace function public.get_management_tasks_v1(
  p_search text default null,
  p_status text default null,
  p_assignee_user_id uuid default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_total integer;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_tasks.view') then
    raise exception 'MANAGEMENT_TASKS_FORBIDDEN' using errcode = '42501';
  end if;

  with scoped_users as (
    select scoped_user_id
    from private.get_management_scope_users_v1(v_uid)
  ),
  base as (
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
        or (
          t.current_assignee_id is null
          and t.user_id in (select scoped_user_id from scoped_users)
        )
      )
      and (p_status is null or p_status = '' or t.status = p_status)
      and (p_assignee_user_id is null or t.current_assignee_id = p_assignee_user_id)
      and (
        p_search is null or btrim(p_search) = ''
        or t.title ilike '%' || p_search || '%'
        or coalesce(t.description, '') ilike '%' || p_search || '%'
      )
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

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'total_count', coalesce(v_total, 0)
  );
end;
$fn$;

revoke all on function public.get_management_tasks_v1(text, text, uuid, integer, integer) from public;
grant execute on function public.get_management_tasks_v1(text, text, uuid, integer, integer) to authenticated;
