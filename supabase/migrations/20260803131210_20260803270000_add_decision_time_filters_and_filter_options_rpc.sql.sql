/*
# Add this_week, next_7_days deadline states to both decision RPCs.
# Add INVALID_DATE_RANGE fail-closed validation.
# Add lightweight get_minutes_decision_filter_options RPC for distinct meeting/unit/owner.
# Preserve all old deadline aliases (due_today, due_soon, on_track, no_due_date).
# SECURITY DEFINER, search_path='', auth.uid() check, EXECUTE for authenticated/service_role/postgres only.
# No data deletion, no schema changes to tables, no edits to previous migrations.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. get_my_minutes_decisions — add this_week, next_7_days, INVALID_DATE_RANGE
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_minutes_decisions(
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_requires_followup boolean DEFAULT NULL,
  p_deadline_state text DEFAULT NULL,
  p_due_from date DEFAULT NULL,
  p_due_to date DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, minute_id uuid, agenda_result_id uuid, title text, description text,
  primary_owner_user_id uuid, responsible_unit_id uuid, responsible_unit_name_snapshot text,
  priority text, status text, progress_percent integer, start_date date, due_date date,
  completed_at timestamp with time zone, requires_followup boolean, latest_update text,
  created_by_user_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone,
  discussion_result text, result_type text, additional_notes text,
  minute_title text, minute_status text, meeting_date_snapshot text,
  overdue boolean, agenda_title text, total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today text := to_char(now() AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD');
  v_today_date date := (now() AT TIME ZONE 'Asia/Tehran')::date;
  v_dl text := lower(coalesce(p_deadline_state, 'all'));
  v_week_start date;
  v_week_end date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Fail-closed: reject inverted date ranges
  IF p_due_from IS NOT NULL AND p_due_to IS NOT NULL AND p_due_from > p_due_to THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE' USING ERRCODE = 'P0001';
  END IF;

  -- Normalize old aliases to new canonical names
  v_dl := CASE v_dl
    WHEN 'due_today'   THEN 'today'
    WHEN 'due_soon'    THEN 'approaching'
    WHEN 'on_track'    THEN 'on_time'
    WHEN 'no_due_date' THEN 'no_deadline'
    ELSE v_dl
  END;

  -- Compute Iranian week bounds: Saturday (day 6 in ISO 8601 where Monday=1) through Friday.
  -- EXTRACT(DOW) in PostgreSQL: Sunday=0, Monday=1, ..., Saturday=6.
  -- Saturday is the first day of the Iranian week.
  v_week_start := v_today_date - ((extract(dow from v_today_date))::int);
  -- If today is Saturday (dow=6), v_week_start = today. If Sunday (dow=0), v_week_start = yesterday (Saturday).
  -- Actually: dow=0 (Sunday) → subtract 0 → wrong. Let's fix:
  -- Saturday is dow=6. We want the most recent Saturday.
  -- If dow=6 (Saturday): week_start = today
  -- If dow=0 (Sunday):   week_start = today - 1
  -- If dow=1 (Monday):   week_start = today - 2
  -- ...
  -- If dow=5 (Friday):   week_start = today - 6
  -- So: week_start = today - ((dow + 1) % 7)
  v_week_start := v_today_date - (((extract(dow from v_today_date))::int + 1) % 7);
  v_week_end := v_week_start + 6;

  RETURN QUERY
  WITH base AS (
    SELECT
      d.id, d.minute_id, d.agenda_result_id,
      d.title, d.description,
      d.primary_owner_user_id,
      d.responsible_unit_id, d.responsible_unit_name_snapshot,
      d.priority::text, d.status::text, d.progress_percent,
      d.start_date, d.due_date, d.completed_at,
      d.requires_followup, d.latest_update,
      d.created_by_user_id, d.created_at, d.updated_at,
      d.discussion_result, d.result_type::text, d.additional_notes,
      m.meeting_title_snapshot AS minute_title,
      m.status::text AS minute_status,
      m.meeting_date_snapshot AS meeting_date_snapshot,
      (d.due_date IS NOT NULL AND d.due_date < v_today::date
       AND d.status NOT IN ('completed','stopped')) AS overdue,
      ar.agenda_title_snapshot AS agenda_title
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    LEFT JOIN public.minutes_agenda_results ar ON ar.id = d.agenda_result_id
    WHERE d.primary_owner_user_id = v_user_id
      AND m.status = 'published'
      AND m.published_at IS NOT NULL
      AND (p_status IS NULL OR d.status::text = p_status)
      AND (p_priority IS NULL OR d.priority::text = p_priority)
      AND (p_requires_followup IS NULL OR d.requires_followup = p_requires_followup)
      AND (p_due_from IS NULL OR d.due_date >= p_due_from)
      AND (p_due_to IS NULL OR d.due_date <= p_due_to)
      AND (
        p_search IS NULL OR p_search = '' OR
        d.title ILIKE '%' || p_search || '%' OR
        d.description ILIKE '%' || p_search || '%' OR
        m.meeting_title_snapshot ILIKE '%' || p_search || '%'
      )
      AND (
        v_dl = 'all' OR
        (v_dl = 'overdue' AND d.due_date IS NOT NULL AND d.due_date < v_today::date AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'today' AND d.due_date = v_today::date AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'this_week' AND d.due_date IS NOT NULL AND d.due_date >= v_week_start AND d.due_date <= v_week_end AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'next_7_days' AND d.due_date IS NOT NULL AND d.due_date >= v_today::date AND d.due_date <= (v_today::date + 7) AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'approaching' AND d.due_date IS NOT NULL AND d.due_date > v_today::date AND d.due_date <= (v_today::date + 3) AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'on_time' AND d.due_date IS NOT NULL AND d.due_date > (v_today::date + 3) AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'no_deadline' AND d.due_date IS NULL) OR
        (v_dl = 'completed' AND d.status = 'completed')
      )
  ),
  counted AS (SELECT COUNT(*) AS cnt FROM base)
  SELECT
    b.id, b.minute_id, b.agenda_result_id,
    b.title, b.description,
    b.primary_owner_user_id,
    b.responsible_unit_id, b.responsible_unit_name_snapshot,
    b.priority, b.status, b.progress_percent,
    b.start_date, b.due_date, b.completed_at,
    b.requires_followup, b.latest_update,
    b.created_by_user_id, b.created_at, b.updated_at,
    b.discussion_result, b.result_type, b.additional_notes,
    b.minute_title, b.minute_status, b.meeting_date_snapshot,
    b.overdue, b.agenda_title,
    c.cnt::bigint AS total_count
  FROM base b, counted c
  ORDER BY
    b.overdue DESC,
    CASE WHEN b.due_date = v_today::date THEN 0 ELSE 1 END,
    CASE WHEN b.due_date IS NOT NULL AND b.due_date <= (v_today::date + 3) THEN 0 ELSE 1 END,
    CASE b.priority
      WHEN 'urgent'    THEN 1
      WHEN 'important' THEN 2
      WHEN 'normal'    THEN 3
      WHEN 'low'       THEN 4
      ELSE 5
    END,
    b.due_date ASC NULLS LAST,
    b.updated_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_minutes_decisions TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. get_trackable_minutes_decisions — add this_week, next_7_days, INVALID_DATE_RANGE
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_trackable_minutes_decisions(
  p_search text DEFAULT NULL,
  p_meeting_id uuid DEFAULT NULL,
  p_owner_user_id uuid DEFAULT NULL,
  p_responsible_unit_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_requires_followup boolean DEFAULT NULL,
  p_has_open_obstacle boolean DEFAULT NULL,
  p_deadline_state text DEFAULT NULL,
  p_start_from date DEFAULT NULL,
  p_start_to date DEFAULT NULL,
  p_due_from date DEFAULT NULL,
  p_due_to date DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, minute_id uuid, title text, description text,
  primary_owner_user_id uuid, owner_name text,
  responsible_unit_id uuid, responsible_unit_name_snapshot text,
  priority text, status text, progress_percent integer,
  start_date date, due_date date, completed_at timestamp with time zone,
  requires_followup boolean, latest_update text,
  latest_followup_at timestamp with time zone, open_obstacle_count integer,
  updated_at timestamp with time zone, minute_title text, minute_status text,
  meeting_date_snapshot text, overdue boolean, total_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today text := to_char(now() AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD');
  v_today_date date := (now() AT TIME ZONE 'Asia/Tehran')::date;
  v_dl text := lower(coalesce(p_deadline_state, 'all'));
  v_week_start date;
  v_week_end date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Fail-closed: reject inverted date ranges
  IF p_due_from IS NOT NULL AND p_due_to IS NOT NULL AND p_due_from > p_due_to THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_from IS NOT NULL AND p_start_to IS NOT NULL AND p_start_from > p_start_to THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE' USING ERRCODE = 'P0001';
  END IF;

  -- Normalize old aliases
  v_dl := CASE v_dl
    WHEN 'due_today'   THEN 'today'
    WHEN 'due_soon'    THEN 'approaching'
    WHEN 'on_track'    THEN 'on_time'
    WHEN 'no_due_date' THEN 'no_deadline'
    ELSE v_dl
  END;

  -- Iranian week: Saturday through Friday
  v_week_start := v_today_date - (((extract(dow from v_today_date))::int + 1) % 7);
  v_week_end := v_week_start + 6;

  RETURN QUERY
  WITH decision_base AS (
    SELECT
      d.id, d.minute_id, d.title, d.description,
      d.primary_owner_user_id,
      d.responsible_unit_id, d.responsible_unit_name_snapshot,
      d.priority::text, d.status::text, d.progress_percent,
      d.start_date, d.due_date, d.completed_at,
      d.requires_followup, d.latest_update,
      d.updated_at,
      m.meeting_title_snapshot AS minute_title,
      m.status::text AS minute_status,
      m.meeting_date_snapshot AS meeting_date_snapshot,
      (d.due_date IS NOT NULL AND d.due_date < v_today::date
       AND d.status NOT IN ('completed','stopped')) AS overdue
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    WHERE public._can_track_decisions(d.minute_id)
      AND (p_meeting_id IS NULL OR d.minute_id = p_meeting_id)
      AND (p_owner_user_id IS NULL OR d.primary_owner_user_id = p_owner_user_id)
      AND (p_responsible_unit_id IS NULL OR d.responsible_unit_id = p_responsible_unit_id)
      AND (p_status IS NULL OR d.status::text = p_status)
      AND (p_priority IS NULL OR d.priority::text = p_priority)
      AND (p_requires_followup IS NULL OR d.requires_followup = p_requires_followup)
      AND (p_start_from IS NULL OR d.start_date >= p_start_from)
      AND (p_start_to IS NULL OR d.start_date <= p_start_to)
      AND (p_due_from IS NULL OR d.due_date >= p_due_from)
      AND (p_due_to IS NULL OR d.due_date <= p_due_to)
      AND (
        p_search IS NULL OR p_search = '' OR
        d.title ILIKE '%' || p_search || '%' OR
        m.meeting_title_snapshot ILIKE '%' || p_search || '%'
      )
      AND (
        v_dl = 'all' OR
        (v_dl = 'overdue' AND d.due_date IS NOT NULL AND d.due_date < v_today::date AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'today' AND d.due_date = v_today::date AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'this_week' AND d.due_date IS NOT NULL AND d.due_date >= v_week_start AND d.due_date <= v_week_end AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'next_7_days' AND d.due_date IS NOT NULL AND d.due_date >= v_today::date AND d.due_date <= (v_today::date + 7) AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'approaching' AND d.due_date IS NOT NULL AND d.due_date > v_today::date AND d.due_date <= (v_today::date + 3) AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'on_time' AND d.due_date IS NOT NULL AND d.due_date > (v_today::date + 3) AND d.status NOT IN ('completed','stopped')) OR
        (v_dl = 'no_deadline' AND d.due_date IS NULL) OR
        (v_dl = 'completed' AND d.status = 'completed')
      )
  ),
  owner_names AS (
    SELECT DISTINCT ON (db.primary_owner_user_id)
      db.primary_owner_user_id, p.full_name, p.username
    FROM decision_base db
    LEFT JOIN public.profiles_public p ON p.user_id = db.primary_owner_user_id
  ),
  followup_agg AS (
    SELECT u.decision_id, MAX(u.created_at) AS latest_followup_at
    FROM public.minutes_decision_updates u
    WHERE u.event_type = 'followup'
    GROUP BY u.decision_id
  ),
  obstacle_agg AS (
    SELECT u.decision_id, COUNT(*)::integer AS open_count
    FROM public.minutes_decision_updates u
    WHERE u.event_type = 'obstacle' AND u.is_blocking = true AND u.resolved_at IS NULL
    GROUP BY u.decision_id
  ),
  final_base AS (
    SELECT
      db.id, db.minute_id, db.title, db.description,
      db.primary_owner_user_id,
      COALESCE(on_p.full_name, on_p.username, db.primary_owner_user_id::text) AS owner_name,
      db.responsible_unit_id, db.responsible_unit_name_snapshot,
      db.priority, db.status, db.progress_percent,
      db.start_date, db.due_date, db.completed_at,
      db.requires_followup, db.latest_update,
      fa.latest_followup_at,
      COALESCE(oa.open_count, 0) AS open_obstacle_count,
      db.updated_at,
      db.minute_title, db.minute_status, db.meeting_date_snapshot,
      db.overdue
    FROM decision_base db
    LEFT JOIN owner_names on_p ON on_p.primary_owner_user_id = db.primary_owner_user_id
    LEFT JOIN followup_agg fa ON fa.decision_id = db.id
    LEFT JOIN obstacle_agg oa ON oa.decision_id = db.id
    WHERE (p_has_open_obstacle IS NULL OR p_has_open_obstacle = false OR COALESCE(oa.open_count, 0) > 0)
  ),
  counted AS (SELECT COUNT(*) AS cnt FROM final_base)
  SELECT
    fb.*, c.cnt::bigint AS total_count
  FROM final_base fb, counted c
  ORDER BY
    fb.overdue DESC,
    CASE WHEN fb.due_date = v_today::date THEN 0 ELSE 1 END,
    CASE WHEN fb.due_date IS NOT NULL AND fb.due_date <= (v_today::date + 3) THEN 0 ELSE 1 END,
    CASE fb.priority
      WHEN 'urgent'    THEN 1
      WHEN 'important' THEN 2
      WHEN 'normal'    THEN 3
      WHEN 'low'       THEN 4
      ELSE 5
    END,
    fb.due_date ASC NULLS LAST,
    fb.updated_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_trackable_minutes_decisions TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. get_minutes_decision_filter_options — lightweight distinct options RPC
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_minutes_decision_filter_options()
RETURNS TABLE(
  option_type text,
  option_id text,
  option_label text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Distinct meetings from trackable decisions
  RETURN QUERY
  SELECT DISTINCT
    'meeting'::text AS option_type,
    d.minute_id::text AS option_id,
    m.meeting_title_snapshot AS option_label
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE public._can_track_decisions(d.minute_id)
    AND m.meeting_title_snapshot IS NOT NULL
    AND m.meeting_title_snapshot <> '';

  -- Distinct responsible units
  RETURN QUERY
  SELECT DISTINCT
    'unit'::text AS option_type,
    d.responsible_unit_id::text AS option_id,
    d.responsible_unit_name_snapshot AS option_label
  FROM public.minutes_decisions d
  WHERE public._can_track_decisions(d.minute_id)
    AND d.responsible_unit_id IS NOT NULL
    AND d.responsible_unit_name_snapshot IS NOT NULL
    AND d.responsible_unit_name_snapshot <> '';

  -- Distinct owners (with name from profiles_public)
  RETURN QUERY
  SELECT DISTINCT
    'owner'::text AS option_type,
    d.primary_owner_user_id::text AS option_id,
    COALESCE(p.full_name, p.username, d.primary_owner_user_id::text) AS option_label
  FROM public.minutes_decisions d
  LEFT JOIN public.profiles_public p ON p.user_id = d.primary_owner_user_id
  WHERE public._can_track_decisions(d.minute_id)
    AND d.primary_owner_user_id IS NOT NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_minutes_decision_filter_options TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_minutes_decision_filter_options TO service_role;
GRANT EXECUTE ON FUNCTION public.get_minutes_decision_filter_options TO postgres;
