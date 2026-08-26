-- Management subtree access for decisions and tasks.
-- Scope is derived from the existing organizational hierarchy; capabilities remain granular.

insert into public.org_level_permissions (level, permission_key, granted)
select md.level, p.permission_key, true
from public.org_level_permissions md
cross join (values
  ('management_decisions.view'),
  ('management_decisions.manage'),
  ('management_tasks.view'),
  ('management_tasks.manage')
) as p(permission_key)
where md.permission_key = 'management_dashboard'
  and md.granted = true
  and not exists (
    select 1
    from public.org_level_permissions x
    where x.level = md.level
      and x.permission_key = p.permission_key
  );

insert into public.org_position_permissions (position_id, permission_key, granted)
select md.position_id, p.permission_key, true
from public.org_position_permissions md
cross join (values
  ('management_decisions.view'),
  ('management_decisions.manage'),
  ('management_tasks.view'),
  ('management_tasks.manage')
) as p(permission_key)
where md.permission_key = 'management_dashboard'
  and md.granted = true
  and not exists (
    select 1
    from public.org_position_permissions x
    where x.position_id = md.position_id
      and x.permission_key = p.permission_key
  );

create or replace function private.management_decision_in_scope_v1(
  p_user_id uuid,
  p_decision_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  with scoped_units as (
    select scoped_unit_id
    from private.get_management_scope_units_v1(p_user_id)
  ),
  scoped_users as (
    select scoped_user_id
    from private.get_management_scope_users_v1(p_user_id)
  )
  select exists (
    select 1
    from public.minutes_decisions d
    join public.minutes m on m.id = d.minute_id
    where d.id = p_decision_id
      and (
        d.responsible_unit_id in (select scoped_unit_id from scoped_units)
        or d.primary_owner_user_id in (select scoped_user_id from scoped_users)
        or m.org_unit_id in (select scoped_unit_id from scoped_units)
      )
  );
$fn$;

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
        or t.user_id in (select scoped_user_id from scoped_users)
        or t.created_by_id in (select scoped_user_id from scoped_users)
      )
  );
$fn$;

revoke all on function private.management_decision_in_scope_v1(uuid, uuid) from public;
revoke all on function private.management_task_in_scope_v1(uuid, uuid) from public;

create or replace function public.get_management_capabilities_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_dashboard') then
    raise exception 'MANAGEMENT_DASHBOARD_FORBIDDEN' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'decisions_view', private.current_user_has_permission_v1('management_decisions.view'),
    'decisions_manage', private.current_user_has_permission_v1('management_decisions.manage'),
    'tasks_view', private.current_user_has_permission_v1('management_tasks.view'),
    'tasks_manage', private.current_user_has_permission_v1('management_tasks.manage')
  );
end;
$fn$;

create or replace function public.get_management_decisions_v2(
  p_search text default null,
  p_status text default null,
  p_unit_id uuid default null,
  p_owner_user_id uuid default null,
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
  if not private.current_user_has_permission_v1('management_decisions.view') then
    raise exception 'MANAGEMENT_DECISIONS_FORBIDDEN' using errcode = '42501';
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
      m.org_unit_id,
      d.created_at,
      d.updated_at,
      (
        d.due_date is not null
        and d.due_date < (timezone('Asia/Tehran', now()))::date
        and d.status not in ('completed', 'stopped')
      ) as overdue,
      (
        select count(*)::integer
        from public.minutes_decision_updates u
        where u.decision_id = d.id
          and u.event_type = 'obstacle'
          and u.is_blocking = true
          and u.resolved_at is null
      ) as open_obstacle_count
    from public.minutes_decisions d
    join public.minutes m on m.id = d.minute_id
    left join public.org_units ou on ou.id = d.responsible_unit_id
    left join public.profiles pp on pp.user_id = d.primary_owner_user_id
    where (
      d.parent_decision_id is not null
      or not exists (
        select 1 from public.minutes_decisions c where c.parent_decision_id = d.id
      )
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

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'total_count', coalesce(v_total, 0)
  );
end;
$fn$;

create or replace function public.get_management_decision_detail_v1(p_decision_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_decisions.view') then
    raise exception 'MANAGEMENT_DECISIONS_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.management_decision_in_scope_v1(v_uid, p_decision_id) then
    raise exception 'DECISION_OUT_OF_SCOPE' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'decision', jsonb_build_object(
      'id', d.id,
      'parent_decision_id', d.parent_decision_id,
      'clause_order', d.clause_order,
      'minute_id', d.minute_id,
      'title', d.title,
      'description', d.description,
      'discussion_result', d.discussion_result,
      'result_type', d.result_type,
      'additional_notes', d.additional_notes,
      'status', d.status,
      'progress_percent', d.progress_percent,
      'priority', d.priority,
      'start_date', d.start_date,
      'due_date', d.due_date,
      'completed_at', d.completed_at,
      'requires_followup', d.requires_followup,
      'latest_update', d.latest_update,
      'responsible_unit_id', d.responsible_unit_id,
      'unit_name', coalesce(nullif(btrim(ou.name), ''), nullif(btrim(d.responsible_unit_name_snapshot), ''), 'بدون واحد'),
      'primary_owner_user_id', d.primary_owner_user_id,
      'owner_name', coalesce(pp.full_name, pp.username, ''),
      'updated_at', d.updated_at,
      'minute_title', m.meeting_title_snapshot,
      'meeting_date', m.meeting_date_snapshot,
      'minute_status', m.status
    ),
    'history', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'previous_status', u.previous_status,
          'new_status', u.new_status,
          'previous_progress_percent', u.previous_progress_percent,
          'new_progress_percent', u.new_progress_percent,
          'update_text', u.update_text,
          'event_type', u.event_type,
          'event_title', u.event_title,
          'event_metadata', u.event_metadata,
          'is_blocking', u.is_blocking,
          'resolved_at', u.resolved_at,
          'created_by_user_id', u.created_by_user_id,
          'actor_name', coalesce(ap.full_name, ap.username, ''),
          'created_at', u.created_at
        )
        order by u.created_at desc
      )
      from public.minutes_decision_updates u
      left join public.profiles ap on ap.user_id = u.created_by_user_id
      where u.decision_id = d.id
    ), '[]'::jsonb),
    'can_manage', private.current_user_has_permission_v1('management_decisions.manage')
  )
  into v_result
  from public.minutes_decisions d
  join public.minutes m on m.id = d.minute_id
  left join public.org_units ou on ou.id = d.responsible_unit_id
  left join public.profiles pp on pp.user_id = d.primary_owner_user_id
  where d.id = p_decision_id;

  return v_result;
end;
$fn$;

create or replace function public.manage_management_decision_v1(
  p_decision_id uuid,
  p_expected_updated_at timestamptz default null,
  p_status text default null,
  p_progress_percent integer default null,
  p_report_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_old public.minutes_decisions%rowtype;
  v_new_status text;
  v_new_progress integer;
  v_updated timestamptz;
  v_event text;
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_decisions.manage') then
    raise exception 'MANAGEMENT_DECISIONS_MANAGE_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.management_decision_in_scope_v1(v_uid, p_decision_id) then
    raise exception 'DECISION_OUT_OF_SCOPE' using errcode = '42501';
  end if;

  select * into v_old
  from public.minutes_decisions
  where id = p_decision_id
  for update;

  if not found then raise exception 'DECISION_NOT_FOUND'; end if;
  if exists(select 1 from public.minutes_decisions c where c.parent_decision_id = p_decision_id) then
    raise exception 'DECISION_PARENT_NOT_EXECUTABLE';
  end if;
  if p_expected_updated_at is not null and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'DECISION_VERSION_CONFLICT';
  end if;
  if not exists(
    select 1 from public.minutes m
    where m.id = v_old.minute_id and m.status = 'published' and m.published_at is not null
  ) then
    raise exception 'MINUTE_NOT_PUBLISHED';
  end if;
  if v_old.status = 'completed' and (p_status is not null or p_progress_percent is not null) then
    raise exception 'COMPLETED_DECISION_IMMUTABLE';
  end if;

  v_new_status := coalesce(p_status, v_old.status);
  v_new_progress := coalesce(p_progress_percent, v_old.progress_percent);

  if v_new_status not in ('not_started', 'planned', 'in_progress', 'waiting_coordination', 'waiting_approval', 'completed', 'stopped') then
    raise exception 'INVALID_STATUS';
  end if;
  if v_new_progress < 0 or v_new_progress > 100 then
    raise exception 'INVALID_PROGRESS';
  end if;
  if v_new_status in ('waiting_approval', 'completed') then
    v_new_progress := 100;
  end if;

  v_event := case
    when v_new_status is distinct from v_old.status then 'status_change'
    when v_new_progress is distinct from v_old.progress_percent then 'progress'
    else 'report'
  end;

  update public.minutes_decisions
  set status = v_new_status,
      progress_percent = v_new_progress,
      completed_at = case when v_new_status = 'completed' then coalesce(completed_at, now()) else null end,
      latest_update = case
        when nullif(btrim(coalesce(p_report_text, '')), '') is not null then p_report_text
        else latest_update
      end,
      updated_at = now()
  where id = p_decision_id
  returning updated_at into v_updated;

  if v_new_status is distinct from v_old.status
     or v_new_progress is distinct from v_old.progress_percent
     or nullif(btrim(coalesce(p_report_text, '')), '') is not null then
    insert into public.minutes_decision_updates(
      decision_id,
      minute_id,
      previous_status,
      new_status,
      previous_progress_percent,
      new_progress_percent,
      update_text,
      event_type,
      event_title,
      event_metadata,
      is_blocking,
      created_by_user_id
    ) values (
      p_decision_id,
      v_old.minute_id,
      v_old.status,
      v_new_status,
      v_old.progress_percent,
      v_new_progress,
      p_report_text,
      v_event,
      'به‌روزرسانی مدیریتی',
      jsonb_build_object('source', 'management_dashboard'),
      false,
      v_uid
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'decision_id', p_decision_id,
    'status', v_new_status,
    'progress_percent', v_new_progress,
    'updated_at', v_updated
  );
end;
$fn$;

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
    select scoped_user_id from private.get_management_scope_users_v1(v_uid)
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
        or t.user_id in (select scoped_user_id from scoped_users)
        or t.created_by_id in (select scoped_user_id from scoped_users)
      )
      and (p_status is null or p_status = '' or t.status = p_status)
      and (p_assignee_user_id is null or t.current_assignee_id = p_assignee_user_id)
      and (
        p_search is null or btrim(p_search) = ''
        or t.title ilike '%' || p_search || '%'
        or t.description ilike '%' || p_search || '%'
      )
  ),
  counted as (
    select count(*)::integer as c from base
  ),
  page as (
    select * from base
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

create or replace function public.get_management_task_detail_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_tasks.view') then
    raise exception 'MANAGEMENT_TASKS_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.management_task_in_scope_v1(v_uid, p_task_id) then
    raise exception 'TASK_OUT_OF_SCOPE' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'task', to_jsonb(t) || jsonb_build_object('assignee_name', coalesce(p.full_name, p.username, t.assignee)),
    'workflow', coalesce((
      select jsonb_agg(
        to_jsonb(w) || jsonb_build_object(
          'actor_name', coalesce(ap.full_name, ap.username, ''),
          'from_name', coalesce(fp.full_name, fp.username, ''),
          'to_name', coalesce(tp.full_name, tp.username, '')
        ) order by w.created_at desc
      )
      from public.task_workflow_steps w
      left join public.profiles ap on ap.user_id = w.actor_id
      left join public.profiles fp on fp.user_id = w.from_user_id
      left join public.profiles tp on tp.user_id = w.to_user_id
      where w.task_id = t.id
    ), '[]'::jsonb),
    'checklist', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.sort_order, c.created_at)
      from public.task_checklist_items c
      where c.task_id = t.id
    ), '[]'::jsonb),
    'dependencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'depends_on_task_id', d.depends_on_task_id,
        'title', dt.title,
        'status', dt.status,
        'created_at', d.created_at
      ))
      from public.task_dependencies d
      left join public.tasks dt on dt.id = d.depends_on_task_id
      where d.task_id = t.id
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'file_name', a.file_name,
        'file_size', a.file_size,
        'mime_type', a.mime_type,
        'created_at', a.created_at
      ))
      from public.task_attachments a
      where a.task_id = t.id
    ), '[]'::jsonb),
    'can_manage', private.current_user_has_permission_v1('management_tasks.manage')
  )
  into v_result
  from public.tasks t
  left join public.profiles p on p.user_id = t.current_assignee_id
  where t.id = p_task_id;

  return v_result;
end;
$fn$;

create or replace function public.manage_management_task_v1(
  p_task_id uuid,
  p_status text default null,
  p_progress_percent integer default null,
  p_priority text default null,
  p_due_date text default null,
  p_assignee_user_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_old public.tasks%rowtype;
  v_assignee_name text;
  v_new_assignee uuid;
  v_new_status text;
  v_new_progress integer;
begin
  if v_uid is null or not private.is_current_session_fully_authorized() then
    raise exception 'AUTH_ACCESS_RESTRICTED' using errcode = '42501';
  end if;
  if not private.current_user_has_permission_v1('management_tasks.manage') then
    raise exception 'MANAGEMENT_TASKS_MANAGE_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.management_task_in_scope_v1(v_uid, p_task_id) then
    raise exception 'TASK_OUT_OF_SCOPE' using errcode = '42501';
  end if;

  select * into v_old
  from public.tasks
  where id = p_task_id
  for update;

  if not found then raise exception 'TASK_NOT_FOUND'; end if;

  v_new_status := coalesce(p_status, v_old.status);
  v_new_progress := coalesce(p_progress_percent, v_old.progress_percent);
  v_new_assignee := coalesce(p_assignee_user_id, v_old.current_assignee_id);

  if v_new_status not in ('pending', 'in_progress', 'completed') then
    raise exception 'INVALID_TASK_STATUS';
  end if;
  if v_new_progress < 0 or v_new_progress > 100 then
    raise exception 'INVALID_PROGRESS';
  end if;
  if v_new_status = 'completed' then
    v_new_progress := 100;
  end if;
  if p_assignee_user_id is not null
     and p_assignee_user_id not in (
       select scoped_user_id from private.get_management_scope_users_v1(v_uid)
     ) then
    raise exception 'ASSIGNEE_OUT_OF_SCOPE' using errcode = '42501';
  end if;
  if p_priority is not null and p_priority not in ('low', 'medium', 'high') then
    raise exception 'INVALID_PRIORITY';
  end if;

  select coalesce(full_name, username)
  into v_assignee_name
  from public.profiles
  where user_id = v_new_assignee;

  update public.tasks
  set status = v_new_status,
      progress_percent = v_new_progress,
      priority = coalesce(p_priority, priority),
      due_date = coalesce(p_due_date, due_date),
      current_assignee_id = v_new_assignee,
      assignee = coalesce(v_assignee_name, assignee)
  where id = p_task_id;

  insert into public.task_workflow_steps(
    task_id,
    actor_id,
    action,
    from_user_id,
    to_user_id,
    note
  ) values (
    p_task_id,
    v_uid,
    'management_update',
    v_old.current_assignee_id,
    v_new_assignee,
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'status', v_new_status,
    'progress_percent', v_new_progress,
    'assignee_user_id', v_new_assignee
  );
end;
$fn$;

revoke all on function public.get_management_capabilities_v1() from public;
revoke all on function public.get_management_decisions_v2(text, text, uuid, uuid, integer, integer) from public;
revoke all on function public.get_management_decision_detail_v1(uuid) from public;
revoke all on function public.manage_management_decision_v1(uuid, timestamptz, text, integer, text) from public;
revoke all on function public.get_management_tasks_v1(text, text, uuid, integer, integer) from public;
revoke all on function public.get_management_task_detail_v1(uuid) from public;
revoke all on function public.manage_management_task_v1(uuid, text, integer, text, text, uuid, text) from public;

grant execute on function public.get_management_capabilities_v1() to authenticated;
grant execute on function public.get_management_decisions_v2(text, text, uuid, uuid, integer, integer) to authenticated;
grant execute on function public.get_management_decision_detail_v1(uuid) to authenticated;
grant execute on function public.manage_management_decision_v1(uuid, timestamptz, text, integer, text) to authenticated;
grant execute on function public.get_management_tasks_v1(text, text, uuid, integer, integer) to authenticated;
grant execute on function public.get_management_task_detail_v1(uuid) to authenticated;
grant execute on function public.manage_management_task_v1(uuid, text, integer, text, text, uuid, text) to authenticated;
