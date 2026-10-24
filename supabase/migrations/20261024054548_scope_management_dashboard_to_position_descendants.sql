-- Read access is available to every FULL authenticated user. Write permissions
-- remain unchanged. Scope follows strictly descendant positions, not shared units.
CREATE OR REPLACE FUNCTION public.has_management_dashboard_access_v1()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (coalesce(auth.jwt()->>'role', '') = 'service_role'
         OR private.is_current_session_fully_authorized())
    AND EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.user_id = auth.uid() AND p.is_active IS TRUE);
$function$;

CREATE OR REPLACE FUNCTION private.get_management_scope_users_v1(p_user_id uuid)
RETURNS TABLE(scoped_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH RECURSIVE roots AS (
    SELECT p.primary_position_id AS id FROM public.profiles p
    WHERE p.user_id = p_user_id AND p.primary_position_id IS NOT NULL
    UNION
    SELECT pm.position_id FROM public.org_position_members pm
    WHERE pm.user_id = p_user_id
  ), descendants(id) AS (
    SELECT child.id FROM public.org_positions child
    JOIN roots r ON child.parent_position_id = r.id
    WHERE child.id NOT IN (SELECT id FROM roots)
    UNION
    SELECT child.id FROM public.org_positions child
    JOIN descendants d ON child.parent_position_id = d.id
    WHERE child.id NOT IN (SELECT id FROM roots)
  )
  SELECT p.user_id FROM public.profiles p
  WHERE p.user_id = p_user_id AND p.is_active IS DISTINCT FROM false
  UNION
  SELECT p.user_id FROM public.profiles p
  WHERE p.is_active IS DISTINCT FROM false
    AND (p.primary_position_id IN (SELECT id FROM descendants)
      OR EXISTS (SELECT 1 FROM public.org_position_members pm
                 WHERE pm.user_id = p.user_id
                   AND pm.position_id IN (SELECT id FROM descendants)));
$function$;

-- Unit membership must never grant access to peers or superiors. Existing
-- management RPCs retain their per-person scope branch; unit-wide branches
-- deliberately match no rows under the position-based model.
CREATE OR REPLACE FUNCTION private.get_management_scope_units_v1(p_user_id uuid)
RETURNS TABLE(scoped_unit_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT NULL::uuid WHERE false AND p_user_id IS NOT NULL;
$function$;

-- Update only dashboard READ gates. Do not change generic permissions or manage
-- permissions. Abort on unfamiliar installed definitions instead of widening them.
DO $migration$
DECLARE
  v_name text;
  v_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'get_management_capabilities_v1', 'get_management_scope_people_v1',
    'get_management_minutes_v1', 'get_management_minutes_dashboard_stats_v1',
    'get_management_decisions_v2', 'get_management_decisions_v3',
    'get_management_tasks_v1', 'get_management_tasks_v2',
    'get_management_decision_detail_v1', 'get_management_task_detail_v1'
  ] LOOP
    SELECT p.oid INTO STRICT v_oid FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;
    SELECT pg_get_functiondef(v_oid) INTO v_definition;
    v_updated := regexp_replace(v_definition,
      $pattern$private[.]current_user_has_permission_v1\s*\(\s*'(management_dashboard|management_decisions[.]view|management_tasks[.]view)'\s*\)$pattern$,
      'public.has_management_dashboard_access_v1()', 'g');
    v_updated := regexp_replace(v_updated,
      $pattern$public[.]_has_permission\s*\(\s*v_uid\s*,\s*'management_dashboard'\s*\)$pattern$,
      'public.has_management_dashboard_access_v1()', 'g');
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'Unsupported management read gate: %', v_name;
    END IF;
    EXECUTE v_updated;
  END LOOP;
END;
$migration$;

CREATE OR REPLACE FUNCTION private.get_management_dashboard_v1_flat_legacy()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_today date := (timezone('Asia/Tehran', now()))::date;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if not public.has_management_dashboard_access_v1() then
    raise exception 'MANAGEMENT_DASHBOARD_FORBIDDEN' using errcode = '42501';
  end if;

  with scoped_users as (
    select scoped_user_id from private.get_management_scope_users_v1(v_user_id)
  ), scoped_meetings as (
    select m.* from public.meetings m
    where m.user_id in (select scoped_user_id from scoped_users)
      or m.meeting_manager in (select scoped_user_id from scoped_users)
      or coalesce(m.participant_user_ids, '{}'::uuid[]) && array(select scoped_user_id from scoped_users)
      or coalesce(m.notify_users, '{}'::uuid[]) && array(select scoped_user_id from scoped_users)
  ), scoped_decisions as (
    select d.* from public.minutes_decisions d
    where d.primary_owner_user_id in (select scoped_user_id from scoped_users)
      and (d.parent_decision_id is not null or not exists (
        select 1 from public.minutes_decisions child where child.parent_decision_id = d.id
      ))
  ), task_base as (
    select
      t.id,
      t.title,
      t.status,
      t.priority,
      t.assignee,
      t.created_at,
      t.current_assignee_id,
      case
        when t.due_date is null or btrim(t.due_date) = '' then null
        when t.due_date ~ '^\d{4}-\d{2}-\d{2}'
          then (t.due_date::timestamptz at time zone 'Asia/Tehran')::date
        else null
      end as due_local_date
    from public.tasks t
    where coalesce(t.archived, false) = false
      and (t.current_assignee_id in (select scoped_user_id from scoped_users)
        or (t.current_assignee_id is null and t.user_id in (select scoped_user_id from scoped_users)))
  ),
  task_normalized as (
    select
      tb.*,
      case
        when tb.status <> 'completed' and tb.due_local_date is not null and tb.due_local_date < v_today then 'overdue'
        when tb.status = 'completed' then 'completed'
        when tb.status = 'in_progress' then 'in_progress'
        else 'pending'
      end as dashboard_status
    from task_base tb
  ),
  stats as (
    select
      count(*)::int as total_tasks,
      count(*) filter (where due_local_date = v_today)::int as today_tasks,
      count(*) filter (where status = 'in_progress')::int as in_progress_tasks,
      count(*) filter (where status = 'completed')::int as completed_tasks,
      count(*) filter (where dashboard_status = 'overdue')::int as overdue_tasks,
      count(*) filter (where priority = 'high' and status <> 'completed')::int as urgent_tasks,
      case
        when count(*) = 0 then 0
        else round((count(*) filter (where status = 'completed')::numeric / count(*)::numeric) * 100)::int
      end as completion_rate
    from task_normalized
  ),
  meeting_stats as (
    select
      count(*)::int as total_meetings,
      count(*) filter (where status = 'open')::int as active_meetings
    from scoped_meetings
  ),
  decision_stats as (
    select count(distinct coalesce(d.parent_decision_id, d.id))::int as total_decisions
    from scoped_decisions d
  ),
  status_distribution as (
    select dashboard_status as status, count(*)::int as count
    from task_normalized
    group by dashboard_status
  ),
  month_series as (
    select generate_series(
      date_trunc('month', timezone('Asia/Tehran', now())) - interval '5 months',
      date_trunc('month', timezone('Asia/Tehran', now())),
      interval '1 month'
    )::date as month_start
  ),
  task_trend as (
    select
      ms.month_start,
      count(tn.id) filter (where tn.status = 'completed')::int as completed,
      count(tn.id) filter (where tn.status = 'in_progress')::int as in_progress,
      count(tn.id) filter (where tn.dashboard_status = 'overdue')::int as overdue,
      count(tn.id)::int as total
    from month_series ms
    left join task_normalized tn
      on (timezone('Asia/Tehran', tn.created_at))::date >= ms.month_start
     and (timezone('Asia/Tehran', tn.created_at))::date < (ms.month_start + interval '1 month')::date
    group by ms.month_start
    order by ms.month_start
  ),
  unit_performance as (
    select
      coalesce(nullif(btrim(md.responsible_unit_name_snapshot), ''), 'بدون واحد') as unit_name,
      count(distinct coalesce(md.parent_decision_id, md.id))::int as decision_count,
      round(avg(greatest(0, least(100, coalesce(md.progress_percent, 0))))::numeric)::int as progress_percent
    from scoped_decisions md
    group by coalesce(nullif(btrim(md.responsible_unit_name_snapshot), ''), 'بدون واحد')
    order by progress_percent desc, decision_count desc, unit_name
    limit 5
  ),
  recent_meetings as (
    select
      m.id,
      m.subject,
      case
        when m.request_date is not null and m.request_date ~ '^\d{4}-\d{2}-\d{2}'
          then (m.request_date::timestamptz at time zone 'Asia/Tehran')::date
        else null
      end as meeting_date,
      m.start_time,
      m.status,
      m.status_type,
      m.priority
    from scoped_meetings m
    order by m.created_at desc nulls last
    limit 5
  ),
  important_tasks as (
    select
      tn.id,
      tn.title,
      tn.status,
      tn.dashboard_status,
      tn.priority,
      tn.assignee,
      tn.due_local_date
    from task_normalized tn
    where tn.status <> 'completed'
    order by
      case when tn.dashboard_status = 'overdue' then 0 else 1 end,
      case tn.priority when 'high' then 0 when 'medium' then 1 else 2 end,
      tn.due_local_date nulls last,
      tn.created_at desc
    limit 5
  ),
  today_schedule as (
    select
      m.id,
      m.subject,
      m.start_time,
      m.location,
      m.is_online,
      m.status_type
    from scoped_meetings m
    where m.request_date is not null
      and m.request_date ~ '^\d{4}-\d{2}-\d{2}'
      and (m.request_date::timestamptz at time zone 'Asia/Tehran')::date = v_today
    order by nullif(m.start_time, '')::time nulls last, m.created_at
    limit 8
  ),
  deadline_alerts as (
    select *
    from (
      select
        tn.id,
        'task'::text as source,
        tn.title,
        tn.due_local_date as due_date,
        (tn.due_local_date - v_today)::int as days_remaining,
        tn.priority
      from task_normalized tn
      where tn.status <> 'completed'
        and tn.due_local_date is not null
        and tn.due_local_date <= v_today + 10

      union all

      select
        md.id,
        'decision'::text as source,
        md.title,
        md.due_date,
        (md.due_date - v_today)::int as days_remaining,
        md.priority
      from scoped_decisions md
      where md.status <> 'completed'
        and md.due_date is not null
        and md.due_date <= v_today + 10
    ) d
    order by days_remaining, due_date, title
    limit 6
  )
  select jsonb_build_object(
    'generated_at', now(),
    'timezone', 'Asia/Tehran',
    'stats', jsonb_build_object(
      'total_tasks', s.total_tasks,
      'today_tasks', s.today_tasks,
      'in_progress_tasks', s.in_progress_tasks,
      'completed_tasks', s.completed_tasks,
      'overdue_tasks', s.overdue_tasks,
      'urgent_tasks', s.urgent_tasks,
      'active_meetings', ms.active_meetings,
      'total_meetings', ms.total_meetings,
      'total_decisions', ds.total_decisions,
      'completion_rate', s.completion_rate
    ),
    'status_distribution', coalesce((
      select jsonb_agg(jsonb_build_object('status', sd.status, 'count', sd.count) order by sd.status)
      from status_distribution sd
    ), '[]'::jsonb),
    'task_trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month_start', tt.month_start,
        'completed', tt.completed,
        'in_progress', tt.in_progress,
        'overdue', tt.overdue,
        'total', tt.total
      ) order by tt.month_start)
      from task_trend tt
    ), '[]'::jsonb),
    'unit_performance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_name', up.unit_name,
        'decision_count', up.decision_count,
        'progress_percent', up.progress_percent
      ) order by up.progress_percent desc, up.decision_count desc)
      from unit_performance up
    ), '[]'::jsonb),
    'recent_meetings', coalesce((
      select jsonb_agg(to_jsonb(rm) order by rm.meeting_date desc nulls last, rm.start_time desc nulls last)
      from recent_meetings rm
    ), '[]'::jsonb),
    'important_tasks', coalesce((
      select jsonb_agg(to_jsonb(it) order by
        case when it.dashboard_status = 'overdue' then 0 else 1 end,
        it.due_local_date nulls last)
      from important_tasks it
    ), '[]'::jsonb),
    'today_schedule', coalesce((
      select jsonb_agg(to_jsonb(ts) order by ts.start_time nulls last)
      from today_schedule ts
    ), '[]'::jsonb),
    'deadline_alerts', coalesce((
      select jsonb_agg(to_jsonb(da) order by da.days_remaining, da.due_date)
      from deadline_alerts da
    ), '[]'::jsonb)
  ) into v_result
  from stats s
  cross join meeting_stats ms
  cross join decision_stats ds;

  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_management_dashboard_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  RETURN private.get_management_dashboard_v1_flat_legacy();
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_management_dashboard_for_user_v1(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
  v_today date := (timezone('Asia/Tehran', now()))::date;
  v_total_tasks integer := 0;
  v_today_tasks integer := 0;
  v_in_progress_tasks integer := 0;
  v_completed_tasks integer := 0;
  v_overdue_tasks integer := 0;
  v_urgent_tasks integer := 0;
  v_completion_rate integer := 0;
  v_total_decisions integer := 0;
  v_status_distribution jsonb := '[]'::jsonb;
  v_task_trend jsonb := '[]'::jsonb;
  v_important_tasks jsonb := '[]'::jsonb;
  v_units jsonb := '[]'::jsonb;
  v_deadlines jsonb := '[]'::jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID';
  END IF;

  IF coalesce(auth.jwt()->>'role', '') <> 'service_role' THEN
    IF auth.uid() IS DISTINCT FROM p_user_id
       OR NOT public.has_management_dashboard_access_v1() THEN
      RAISE EXCEPTION 'MANAGEMENT_DASHBOARD_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.user_id = p_user_id AND p.is_active IS TRUE) THEN
    RAISE EXCEPTION 'MANAGEMENT_DASHBOARD_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  v_result := public.get_management_dashboard_v1();

  WITH scoped_users AS (
    SELECT scoped_user_id AS user_id
    FROM private.get_management_scope_users_v1(p_user_id)
  ),
  task_base AS (
    SELECT
      t.id, t.title, t.status, t.priority, t.assignee, t.created_at,
      CASE
        WHEN t.due_date IS NULL OR btrim(t.due_date) = '' THEN NULL
        WHEN t.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (t.due_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date
        ELSE NULL
      END AS due_local_date
    FROM public.tasks t
    WHERE COALESCE(t.archived, false) = false
      AND (
        t.current_assignee_id IN (SELECT user_id FROM scoped_users)
        OR (t.current_assignee_id IS NULL AND t.user_id IN (SELECT user_id FROM scoped_users))
      )
  ),
  task_normalized AS (
    SELECT tb.*,
      CASE
        WHEN tb.status <> 'completed' AND tb.due_local_date IS NOT NULL AND tb.due_local_date < v_today THEN 'overdue'
        WHEN tb.status = 'completed' THEN 'completed'
        WHEN tb.status = 'in_progress' THEN 'in_progress'
        ELSE 'pending'
      END AS dashboard_status
    FROM task_base tb
  )
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE due_local_date = v_today)::integer,
    COUNT(*) FILTER (WHERE status = 'in_progress')::integer,
    COUNT(*) FILTER (WHERE status = 'completed')::integer,
    COUNT(*) FILTER (WHERE dashboard_status = 'overdue')::integer,
    COUNT(*) FILTER (WHERE priority = 'high' AND status <> 'completed')::integer,
    CASE WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND((COUNT(*) FILTER (WHERE status = 'completed')::numeric / COUNT(*)::numeric) * 100)::integer
    END
  INTO
    v_total_tasks, v_today_tasks, v_in_progress_tasks, v_completed_tasks,
    v_overdue_tasks, v_urgent_tasks, v_completion_rate
  FROM task_normalized;

  WITH scoped_users AS (
    SELECT scoped_user_id AS user_id
    FROM private.get_management_scope_users_v1(p_user_id)
  ),
  task_base AS (
    SELECT t.status,
      CASE
        WHEN t.due_date IS NULL OR btrim(t.due_date) = '' THEN NULL
        WHEN t.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (t.due_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date
        ELSE NULL
      END AS due_local_date
    FROM public.tasks t
    WHERE COALESCE(t.archived, false) = false
      AND (
        t.current_assignee_id IN (SELECT user_id FROM scoped_users)
        OR (t.current_assignee_id IS NULL AND t.user_id IN (SELECT user_id FROM scoped_users))
      )
  ),
  normalized AS (
    SELECT CASE
      WHEN status <> 'completed' AND due_local_date IS NOT NULL AND due_local_date < v_today THEN 'overdue'
      WHEN status = 'completed' THEN 'completed'
      WHEN status = 'in_progress' THEN 'in_progress'
      ELSE 'pending'
    END AS dashboard_status
    FROM task_base
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('status', dashboard_status, 'count', item_count) ORDER BY dashboard_status),
    '[]'::jsonb
  )
  INTO v_status_distribution
  FROM (
    SELECT dashboard_status, COUNT(*)::integer AS item_count
    FROM normalized
    GROUP BY dashboard_status
  ) s;

  WITH scoped_users AS (
    SELECT scoped_user_id AS user_id
    FROM private.get_management_scope_users_v1(p_user_id)
  ),
  month_series AS (
    SELECT generate_series(
      date_trunc('month', timezone('Asia/Tehran', now())) - interval '5 months',
      date_trunc('month', timezone('Asia/Tehran', now())),
      interval '1 month'
    )::date AS month_start
  ),
  task_base AS (
    SELECT t.id, t.status, t.created_at,
      CASE
        WHEN t.due_date IS NULL OR btrim(t.due_date) = '' THEN NULL
        WHEN t.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (t.due_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date
        ELSE NULL
      END AS due_local_date
    FROM public.tasks t
    WHERE COALESCE(t.archived, false) = false
      AND (
        t.current_assignee_id IN (SELECT user_id FROM scoped_users)
        OR (t.current_assignee_id IS NULL AND t.user_id IN (SELECT user_id FROM scoped_users))
      )
  ),
  normalized AS (
    SELECT tb.*,
      CASE
        WHEN tb.status <> 'completed' AND tb.due_local_date IS NOT NULL AND tb.due_local_date < v_today THEN 'overdue'
        WHEN tb.status = 'completed' THEN 'completed'
        WHEN tb.status = 'in_progress' THEN 'in_progress'
        ELSE 'pending'
      END AS dashboard_status
    FROM task_base tb
  ),
  trend AS (
    SELECT
      ms.month_start,
      COUNT(n.id) FILTER (WHERE n.status = 'completed')::integer AS completed,
      COUNT(n.id) FILTER (WHERE n.status = 'in_progress')::integer AS in_progress,
      COUNT(n.id) FILTER (WHERE n.dashboard_status = 'overdue')::integer AS overdue,
      COUNT(n.id)::integer AS total
    FROM month_series ms
    LEFT JOIN normalized n
      ON (timezone('Asia/Tehran', n.created_at))::date >= ms.month_start
     AND (timezone('Asia/Tehran', n.created_at))::date < (ms.month_start + interval '1 month')::date
    GROUP BY ms.month_start
    ORDER BY ms.month_start
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'month_start', month_start, 'completed', completed,
        'in_progress', in_progress, 'overdue', overdue, 'total', total
      ) ORDER BY month_start
    ),
    '[]'::jsonb
  )
  INTO v_task_trend
  FROM trend;

  WITH scoped_users AS (
    SELECT scoped_user_id AS user_id
    FROM private.get_management_scope_users_v1(p_user_id)
  ),
  task_base AS (
    SELECT t.id, t.title, t.status, t.priority, t.assignee, t.created_at,
      CASE
        WHEN t.due_date IS NULL OR btrim(t.due_date) = '' THEN NULL
        WHEN t.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (t.due_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date
        ELSE NULL
      END AS due_local_date
    FROM public.tasks t
    WHERE COALESCE(t.archived, false) = false
      AND (
        t.current_assignee_id IN (SELECT user_id FROM scoped_users)
        OR (t.current_assignee_id IS NULL AND t.user_id IN (SELECT user_id FROM scoped_users))
      )
  ),
  normalized AS (
    SELECT tb.*,
      CASE
        WHEN tb.status <> 'completed' AND tb.due_local_date IS NOT NULL AND tb.due_local_date < v_today THEN 'overdue'
        WHEN tb.status = 'completed' THEN 'completed'
        WHEN tb.status = 'in_progress' THEN 'in_progress'
        ELSE 'pending'
      END AS dashboard_status
    FROM task_base tb
  ),
  ranked AS (
    SELECT *
    FROM normalized
    WHERE status <> 'completed'
    ORDER BY
      CASE WHEN dashboard_status = 'overdue' THEN 0 ELSE 1 END,
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      due_local_date NULLS LAST,
      created_at DESC
    LIMIT 5
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id, 'title', title, 'status', status, 'dashboard_status', dashboard_status,
        'priority', priority, 'assignee', assignee, 'due_local_date', due_local_date
      )
      ORDER BY CASE WHEN dashboard_status = 'overdue' THEN 0 ELSE 1 END, due_local_date NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_important_tasks
  FROM ranked;

  WITH scoped_units AS (
    SELECT scoped_unit_id AS unit_id FROM private.get_management_scope_units_v1(p_user_id)
  ),
  scoped_users AS (
    SELECT scoped_user_id AS user_id FROM private.get_management_scope_users_v1(p_user_id)
  ),
  scoped_roots AS (
    SELECT root.id
    FROM public.minutes_decisions root
    JOIN public.minutes m ON m.id = root.minute_id
    WHERE root.parent_decision_id IS NULL
      AND (
        root.responsible_unit_id IN (SELECT unit_id FROM scoped_units)
        OR root.primary_owner_user_id IN (SELECT user_id FROM scoped_users)
        OR m.org_unit_id IN (SELECT unit_id FROM scoped_units)
        OR EXISTS (
          SELECT 1
          FROM public.minutes_decisions child
          WHERE child.parent_decision_id = root.id
            AND (
              child.responsible_unit_id IN (SELECT unit_id FROM scoped_units)
              OR child.primary_owner_user_id IN (SELECT user_id FROM scoped_users)
            )
        )
      )
  )
  SELECT COUNT(*)::integer INTO v_total_decisions FROM scoped_roots;

  WITH scoped_units AS (
    SELECT scoped_unit_id AS unit_id FROM private.get_management_scope_units_v1(p_user_id)
  ),
  scoped_users AS (
    SELECT scoped_user_id AS user_id FROM private.get_management_scope_users_v1(p_user_id)
  ),
  executable AS (
    SELECT
      d.responsible_unit_id AS unit_id,
      COALESCE(NULLIF(btrim(ou.name), ''), NULLIF(btrim(d.responsible_unit_name_snapshot), ''), 'بدون واحد') AS unit_name,
      COALESCE(d.parent_decision_id, d.id) AS decision_group_id,
      GREATEST(0, LEAST(100, COALESCE(d.progress_percent, 0)))::integer AS progress_percent
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    LEFT JOIN public.org_units ou ON ou.id = d.responsible_unit_id
    WHERE (
      d.parent_decision_id IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM public.minutes_decisions c WHERE c.parent_decision_id = d.id)
    )
      AND (
        d.responsible_unit_id IN (SELECT unit_id FROM scoped_units)
        OR d.primary_owner_user_id IN (SELECT user_id FROM scoped_users)
        OR m.org_unit_id IN (SELECT unit_id FROM scoped_units)
      )
  ),
  grouped AS (
    SELECT unit_id, unit_name,
      COUNT(DISTINCT decision_group_id)::integer AS decision_count,
      ROUND(AVG(progress_percent)::numeric)::integer AS progress_percent
    FROM executable
    GROUP BY unit_id, unit_name
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'unit_id', unit_id, 'unit_name', unit_name,
        'decision_count', decision_count, 'progress_percent', progress_percent
      )
      ORDER BY progress_percent DESC, decision_count DESC, unit_name
    ),
    '[]'::jsonb
  )
  INTO v_units
  FROM grouped;

  WITH scoped_units AS (
    SELECT scoped_unit_id AS unit_id FROM private.get_management_scope_units_v1(p_user_id)
  ),
  scoped_users AS (
    SELECT scoped_user_id AS user_id FROM private.get_management_scope_users_v1(p_user_id)
  ),
  task_deadlines AS (
    SELECT
      t.id, 'task'::text AS source, t.title,
      CASE
        WHEN t.due_date IS NULL OR btrim(t.due_date) = '' THEN NULL
        WHEN t.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (t.due_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date
        ELSE NULL
      END AS due_date,
      t.priority, NULL::uuid AS minute_id
    FROM public.tasks t
    WHERE COALESCE(t.archived, false) = false
      AND t.status <> 'completed'
      AND (
        t.current_assignee_id IN (SELECT user_id FROM scoped_users)
        OR (t.current_assignee_id IS NULL AND t.user_id IN (SELECT user_id FROM scoped_users))
      )
  ),
  decision_deadlines AS (
    SELECT d.id, 'decision'::text AS source, d.title, d.due_date, d.priority, d.minute_id
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    WHERE (
      d.parent_decision_id IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM public.minutes_decisions c WHERE c.parent_decision_id = d.id)
    )
      AND d.status NOT IN ('completed', 'stopped')
      AND (
        d.responsible_unit_id IN (SELECT unit_id FROM scoped_units)
        OR d.primary_owner_user_id IN (SELECT user_id FROM scoped_users)
        OR m.org_unit_id IN (SELECT unit_id FROM scoped_units)
      )
  ),
  combined AS (
    SELECT id, source, title, due_date, priority, minute_id, (due_date - v_today)::integer AS days_remaining
    FROM task_deadlines
    WHERE due_date IS NOT NULL AND due_date <= v_today + 10
    UNION ALL
    SELECT id, source, title, due_date, priority, minute_id, (due_date - v_today)::integer AS days_remaining
    FROM decision_deadlines
    WHERE due_date IS NOT NULL AND due_date <= v_today + 10
  ),
  limited AS (
    SELECT * FROM combined ORDER BY days_remaining, due_date, title LIMIT 6
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', id, 'source', source, 'title', title, 'due_date', due_date,
          'days_remaining', days_remaining, 'priority', priority, 'minute_id', minute_id
        )
      )
      ORDER BY days_remaining, due_date, title
    ),
    '[]'::jsonb
  )
  INTO v_deadlines
  FROM limited;

  v_result := jsonb_set(
    v_result,
    '{stats}',
    COALESCE(v_result->'stats', '{}'::jsonb) || jsonb_build_object(
      'total_tasks', v_total_tasks,
      'today_tasks', v_today_tasks,
      'in_progress_tasks', v_in_progress_tasks,
      'completed_tasks', v_completed_tasks,
      'overdue_tasks', v_overdue_tasks,
      'urgent_tasks', v_urgent_tasks,
      'total_decisions', v_total_decisions,
      'completion_rate', v_completion_rate
    ),
    true
  );
  v_result := jsonb_set(v_result, '{status_distribution}', v_status_distribution, true);
  v_result := jsonb_set(v_result, '{task_trend}', v_task_trend, true);
  v_result := jsonb_set(v_result, '{important_tasks}', v_important_tasks, true);
  v_result := jsonb_set(v_result, '{unit_performance}', v_units, true);
  v_result := jsonb_set(v_result, '{deadline_alerts}', v_deadlines, true);

  v_result := jsonb_set(
    v_result,
    '{today_schedule}',
    private.get_management_today_schedule_v1(p_user_id),
    true
  );

  RETURN v_result;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.get_management_dashboard_decisions_for_user_v1(p_user_id uuid, p_unit_id uuid DEFAULT NULL::uuid, p_unit_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
  v_unit_name text := NULLIF(btrim(p_unit_name), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID';
  END IF;

  IF coalesce(auth.jwt()->>'role', '') <> 'service_role' THEN
    IF auth.uid() IS DISTINCT FROM p_user_id
       OR NOT public.has_management_dashboard_access_v1() THEN
      RAISE EXCEPTION 'MANAGEMENT_DASHBOARD_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.user_id = p_user_id AND p.is_active IS TRUE) THEN
    RAISE EXCEPTION 'MANAGEMENT_DASHBOARD_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  WITH scoped_units AS (
    SELECT scoped_unit_id AS unit_id FROM private.get_management_scope_units_v1(p_user_id)
  ),
  scoped_users AS (
    SELECT scoped_user_id AS user_id FROM private.get_management_scope_users_v1(p_user_id)
  ),
  q AS (
    SELECT
      d.id,
      COALESCE(d.parent_decision_id, d.id) AS decision_group_id,
      d.minute_id, d.title, d.description, d.status,
      GREATEST(0, LEAST(100, COALESCE(d.progress_percent, 0)))::integer AS progress_percent,
      d.priority, d.due_date,
      d.responsible_unit_id AS unit_id,
      COALESCE(NULLIF(btrim(ou.name), ''), NULLIF(btrim(d.responsible_unit_name_snapshot), ''), 'بدون واحد') AS unit_name,
      d.updated_at
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    LEFT JOIN public.org_units ou ON ou.id = d.responsible_unit_id
    WHERE (
      d.parent_decision_id IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM public.minutes_decisions c WHERE c.parent_decision_id = d.id)
    )
      AND (
        d.responsible_unit_id IN (SELECT unit_id FROM scoped_units)
        OR d.primary_owner_user_id IN (SELECT user_id FROM scoped_users)
        OR m.org_unit_id IN (SELECT unit_id FROM scoped_units)
      )
      AND (
        (p_unit_id IS NULL AND v_unit_name IS NULL)
        OR (p_unit_id IS NOT NULL AND d.responsible_unit_id = p_unit_id)
        OR (
          p_unit_id IS NULL AND v_unit_name IS NOT NULL
          AND d.responsible_unit_id IS NULL
          AND COALESCE(NULLIF(btrim(d.responsible_unit_name_snapshot), ''), 'بدون واحد') = v_unit_name
        )
      )
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id, 'decision_group_id', decision_group_id, 'minute_id', minute_id,
        'title', title, 'description', description, 'status', status,
        'progress_percent', progress_percent, 'priority', priority, 'due_date', due_date,
        'unit_id', unit_id, 'unit_name', unit_name, 'updated_at', updated_at
      )
      ORDER BY due_date ASC NULLS LAST, updated_at DESC, id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM q;

  RETURN v_result;
END;
$function$
;
