/*
# Fix decision RPCs: deadline enum, not_started in active, Tehran overdue,
# total_count after all filters, waiting_approval forces progress=100
#
# Backward-compatible: accepts both new and old deadline enum aliases.
# No data deletion or modification. SECURITY DEFINER, search_path='' preserved.
# GRANTs: authenticated only (no anon/PUBLIC).
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. get_my_minutes_decisions — accept new+old deadline aliases, Tehran overdue
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
  v_dl text := lower(coalesce(p_deadline_state, 'all'));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Normalize old aliases to new canonical names
  v_dl := CASE v_dl
    WHEN 'due_today'   THEN 'today'
    WHEN 'due_soon'    THEN 'approaching'
    WHEN 'on_track'    THEN 'on_time'
    WHEN 'no_due_date' THEN 'no_deadline'
    ELSE v_dl
  END;

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
-- 2. get_my_minutes_decisions_summary — not_started in active, Tehran overdue
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_minutes_decisions_summary()
RETURNS TABLE(
  total_count integer, active_count integer, completed_count integer,
  stopped_count integer, overdue_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today text := to_char(now() AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::integer AS total_count,
    COUNT(*) FILTER (WHERE status IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval'))::integer AS active_count,
    COUNT(*) FILTER (WHERE status = 'completed')::integer AS completed_count,
    COUNT(*) FILTER (WHERE status = 'stopped')::integer AS stopped_count,
    COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < v_today::date
      AND status NOT IN ('completed','stopped'))::integer AS overdue_count
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE d.primary_owner_user_id = v_user_id
    AND m.status = 'published'
    AND m.published_at IS NOT NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_minutes_decisions_summary TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. get_trackable_minutes_decisions — accept new+old deadline aliases,
--    total_count AFTER obstacle filter, Tehran overdue
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
  v_dl text := lower(coalesce(p_deadline_state, 'all'));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Normalize old aliases to new canonical names
  v_dl := CASE v_dl
    WHEN 'due_today'   THEN 'today'
    WHEN 'due_soon'    THEN 'approaching'
    WHEN 'on_track'    THEN 'on_time'
    WHEN 'no_due_date' THEN 'no_deadline'
    ELSE v_dl
  END;

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
-- 4. get_trackable_minutes_decisions_summary — not_started in active, Tehran overdue
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_trackable_minutes_decisions_summary()
RETURNS TABLE(
  total_count integer, active_count integer, completed_count integer,
  stopped_count integer, overdue_count integer, open_obstacle_count integer,
  requires_followup_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today text := to_char(now() AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(DISTINCT d.id)::integer AS total_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.status IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval'))::integer AS active_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'completed')::integer AS completed_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'stopped')::integer AS stopped_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.due_date IS NOT NULL AND d.due_date < v_today::date
      AND d.status NOT IN ('completed','stopped'))::integer AS overdue_count,
    COUNT(DISTINCT d.id) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.minutes_decision_updates u
      WHERE u.decision_id = d.id AND u.is_blocking = true AND u.resolved_at IS NULL
    ))::integer AS open_obstacle_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.requires_followup = true
      AND d.status NOT IN ('completed','stopped'))::integer AS requires_followup_count
  FROM public.minutes_decisions d
  WHERE public._can_track_decisions(d.minute_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_trackable_minutes_decisions_summary TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. update_my_minutes_decision — waiting_approval forces progress=100,
--    completed_at stays NULL, status stays waiting_approval
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_my_minutes_decision(
  p_decision_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_progress_percent integer DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_report_text text DEFAULT NULL,
  p_event_type text DEFAULT 'progress',
  p_event_title text DEFAULT NULL,
  p_event_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id           uuid := auth.uid();
  v_decision          public.minutes_decisions%ROWTYPE;
  v_minute_status     text;
  v_minute_published_at timestamptz;
  v_minute_id         uuid;
  v_secretary_id      uuid;
  v_chair_id          uuid;
  v_created_by        uuid;
  v_revision          integer;
  v_new_status        text;
  v_new_progress      integer;
  v_new_completed_at timestamptz;
  v_new_updated_at   timestamptz;
  v_event_type        text := p_event_type;
  v_event_title       text := p_event_title;
  v_is_meaningful     boolean := false;
  v_is_blocking       boolean := false;
  v_update_id         uuid;
  v_recipient         uuid;
  v_audience          text;
  v_seen              uuid[] := '{}'::uuid[];
  v_notif_event_type  text;
  v_notif_title       text;
  v_notif_msg         text;
  v_event_key         text;
  v_msg_text          text;
  v_diag_sqlstate     text;
  v_actor_name        text;
  v_obstacle_title    text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF v_event_type NOT IN ('progress','status_change','report','obstacle','obstacle_resolved','completion') THEN
    RAISE EXCEPTION 'INVALID_EVENT_TYPE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_decision FROM public.minutes_decisions WHERE id = p_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_decision.primary_owner_user_id <> v_user_id THEN
    RAISE EXCEPTION 'NOT_DECISION_OWNER' USING ERRCODE = 'P0001';
  END IF;

  v_minute_id := v_decision.minute_id;
  IF p_expected_updated_at IS NOT NULL AND v_decision.updated_at IS NOT NULL
     AND v_decision.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'DECISION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.status, m.published_at, m.secretary_user_id, m.chair_user_id, m.created_by_user_id, m.revision_number
  INTO v_minute_status, v_minute_published_at, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes m WHERE m.id = v_minute_id;

  IF v_minute_status <> 'published' OR v_minute_published_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MINUTES_NOT_PUBLISHED',
      'message', 'این مصوبه تا زمان انتشار صورت‌جلسه قابل مشاهده یا پیگیری نیست.');
  END IF;

  IF v_decision.status = 'completed' AND v_event_type <> 'completion' THEN
    RAISE EXCEPTION 'COMPLETED_DECISION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  IF v_event_type = 'obstacle' THEN
    v_obstacle_title := NULLIF(btrim(COALESCE(v_event_title, '')), '');
    IF v_obstacle_title IS NULL THEN
      RAISE EXCEPTION 'OBSTACLE_TITLE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_new_status   := COALESCE(p_status, v_decision.status);
  v_new_progress := COALESCE(p_progress_percent, v_decision.progress_percent);
  IF v_new_progress IS NULL OR v_new_progress < 0 OR v_new_progress > 100 THEN
    RAISE EXCEPTION 'INVALID_PROGRESS' USING ERRCODE = 'P0001';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN (
    'not_started','planned','in_progress','waiting_coordination',
    'waiting_approval','completed','stopped'
  ) THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
  END IF;

  -- Completion: force progress=100, status=completed, completed_at=now()
  IF v_event_type = 'completion' THEN
    v_new_progress := 100;
    v_new_status   := 'completed';
    v_event_title  := COALESCE(v_event_title, 'تکمیل مصوبه');
  ELSIF v_new_status = 'completed' AND v_event_type <> 'completion' THEN
    RAISE EXCEPTION 'USE_COMPLETION_OPERATION' USING ERRCODE = 'P0001';
  END IF;

  -- waiting_approval invariant: progress must be 100, completed_at stays NULL
  IF v_new_status = 'waiting_approval' THEN
    v_new_progress := 100;
    v_new_completed_at := NULL;
  ELSIF v_new_status = 'completed' AND v_new_progress <> 100 THEN
    RAISE EXCEPTION 'COMPLETION_REQUIRES_100_PERCENT' USING ERRCODE = 'P0001';
  ELSE
    v_new_completed_at := CASE WHEN v_new_status = 'completed' THEN now() ELSE NULL END;
  END IF;

  IF v_decision.status IS DISTINCT FROM v_new_status
     OR v_decision.progress_percent IS DISTINCT FROM v_new_progress
     OR COALESCE(p_report_text, '') IS DISTINCT FROM COALESCE(v_decision.latest_update, '')
  THEN
    v_is_meaningful := true;
  END IF;

  IF v_event_type = 'progress' THEN
    IF v_decision.status IS DISTINCT FROM v_new_status AND v_decision.progress_percent IS DISTINCT FROM v_new_progress THEN
      v_event_type := 'progress';
    ELSIF v_decision.status IS DISTINCT FROM v_new_status THEN
      v_event_type := 'status_change';
    ELSIF v_decision.progress_percent IS DISTINCT FROM v_new_progress THEN
      v_event_type := 'progress';
    ELSIF p_report_text IS NOT NULL AND p_report_text <> '' THEN
      v_event_type := 'report';
    END IF;
  END IF;

  v_is_blocking := (v_event_type = 'obstacle');

  UPDATE public.minutes_decisions SET
    status = v_new_status,
    progress_percent = v_new_progress,
    completed_at = v_new_completed_at,
    latest_update = COALESCE(p_report_text, latest_update),
    updated_at = now()
  WHERE id = p_decision_id
  RETURNING updated_at INTO v_new_updated_at;

  IF v_is_meaningful OR v_event_type IN ('report','obstacle','obstacle_resolved','completion') THEN
    INSERT INTO public.minutes_decision_updates (
      decision_id, minute_id, previous_status, new_status,
      previous_progress_percent, new_progress_percent,
      update_text, event_type, event_title, event_metadata, is_blocking,
      created_by_user_id
    ) VALUES (
      p_decision_id, v_minute_id, v_decision.status, v_new_status,
      v_decision.progress_percent, v_new_progress, p_report_text,
      v_event_type, v_event_title, COALESCE(p_event_metadata, '{}'::jsonb), v_is_blocking, v_user_id
    )
    RETURNING id INTO v_update_id;
  END IF;

  v_actor_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_user_id LIMIT 1),
    'کاربر'
  );

  IF v_event_type = 'progress' THEN
    v_notif_event_type := 'decision_progress_updated';
    v_notif_title      := 'به‌روزرسانی پیشرفت مصوبه';
    v_notif_msg        := 'پیشرفت مصوبه به‌روزرسانی شد: ' || v_decision.title;
  ELSIF v_event_type = 'status_change' THEN
    v_notif_event_type := 'decision_status_changed';
    v_notif_title      := 'تغییر وضعیت مصوبه';
    v_notif_msg        := 'وضعیت مصوبه تغییر کرد: ' || v_decision.title;
  ELSIF v_event_type = 'obstacle' THEN
    v_notif_event_type := 'decision_obstacle';
    v_notif_title      := 'مانع جدید برای مصوبه';
    v_notif_msg        := 'مانع جدید ثبت شد: ' || COALESCE(v_event_title, v_decision.title);
  ELSIF v_event_type = 'completion' THEN
    v_notif_event_type := 'decision_completed';
    v_notif_title      := 'مصوبه تکمیل شد';
    v_notif_msg        := 'مصوبه تکمیل شد: ' || v_decision.title;
  ELSIF v_event_type = 'obstacle_resolved' THEN
    v_notif_event_type := 'decision_obstacle_resolved';
    v_notif_title      := 'مانع مصوبه رفع شد';
    v_notif_msg        := 'مانع رفع شد: ' || v_decision.title;
  END IF;

  IF v_notif_event_type IS NOT NULL AND v_update_id IS NOT NULL THEN
    FOREACH v_recipient IN ARRAY ARRAY[v_created_by, v_secretary_id, v_chair_id] LOOP
      IF v_recipient IS NULL THEN CONTINUE; END IF;
      IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
      v_seen := array_append(v_seen, v_recipient);
      IF v_recipient IS DISTINCT FROM v_user_id THEN
        v_audience := CASE
          WHEN v_recipient = v_created_by THEN 'creator'
          WHEN v_recipient = v_secretary_id THEN 'secretary'
          WHEN v_recipient = v_chair_id THEN 'chair'
          ELSE 'all'
        END;
        v_event_key := 'decision:' || p_decision_id::text || ':' || v_notif_event_type || ':' || v_update_id::text || ':' || v_recipient::text;
        PERFORM public._create_minutes_notification(
          v_recipient, v_notif_event_type, v_notif_title, v_notif_msg,
          'decision', p_decision_id, v_minute_id, v_revision, v_user_id,
          jsonb_build_object(
            'decision_id', p_decision_id, 'event_type', v_event_type,
            'decision_title', v_decision.title,
            'decision_status', COALESCE(v_new_status, v_decision.status),
            'previous_decision_status', v_decision.status,
            'decision_progress', COALESCE(v_new_progress::text, ''),
            'obstacle_title', COALESCE(v_obstacle_title, COALESCE(v_event_title, '')),
            'audience', v_audience,
            'actor_name', v_actor_name
          ),
          v_event_key
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'decision_id', p_decision_id,
    'status', v_new_status,
    'progress_percent', v_new_progress,
    'completed_at', v_new_completed_at,
    'updated_at', v_new_updated_at,
    'history_written', v_update_id IS NOT NULL
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_my_minutes_decision TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. manage_minutes_decision — waiting_approval forces progress=100,
--    completed_at stays NULL, status stays waiting_approval
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.manage_minutes_decision(
  p_decision_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_operation text,
  p_new_status text DEFAULT NULL,
  p_event_title text DEFAULT NULL,
  p_report_text text DEFAULT NULL,
  p_event_metadata jsonb DEFAULT '{}'::jsonb,
  p_obstacle_update_id uuid DEFAULT NULL,
  p_remind_at timestamp with time zone DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id          uuid := auth.uid();
  v_decision         public.minutes_decisions%ROWTYPE;
  v_minute_id        uuid;
  v_minute_status    text;
  v_minute_published_at timestamptz;
  v_secretary_id     uuid;
  v_chair_id         uuid;
  v_created_by       uuid;
  v_revision         integer;
  v_is_owner         boolean;
  v_is_manager       boolean;
  v_allowed          boolean := false;
  v_event_type       text;
  v_is_blocking      boolean := false;
  v_new_status       text;
  v_new_progress     integer;
  v_new_completed_at timestamptz;
  v_new_updated_at   timestamptz;
  v_obstacle_exists  boolean;
  v_update_id        uuid;
  v_recipient        uuid;
  v_audience         text;
  v_seen             uuid[] := '{}'::uuid[];
  v_notif_event_type text;
  v_notif_title      text;
  v_notif_msg        text;
  v_event_key        text;
  v_msg_text         text;
  v_actor_name       text;
  v_owner_name       text;
  v_diag_sqlstate    text;
  v_diag_msg         text;
  v_diag_detail      text;
  v_diag_hint        text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF p_operation NOT IN ('status_change','followup','obstacle','obstacle_resolved','reopened','completion') THEN
    RAISE EXCEPTION 'INVALID_OPERATION' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_decision
  FROM public.minutes_decisions d
  WHERE d.id = p_decision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_minute_id := v_decision.minute_id;

  IF p_expected_updated_at IS NOT NULL AND v_decision.updated_at IS NOT NULL
     AND v_decision.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'DECISION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.status, m.published_at, m.secretary_user_id, m.chair_user_id, m.created_by_user_id, m.revision_number
  INTO v_minute_status, v_minute_published_at, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes m WHERE m.id = v_minute_id;

  IF v_minute_status IS DISTINCT FROM 'published' OR v_minute_published_at IS NULL THEN
    RAISE EXCEPTION 'MINUTE_NOT_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;

  v_is_owner := (v_decision.primary_owner_user_id = v_user_id);

  IF p_operation IN ('status_change', 'obstacle', 'obstacle_resolved', 'reopened', 'completion') THEN
    v_is_manager := (
      public.is_current_user_admin()
      OR v_created_by = v_user_id
      OR v_secretary_id = v_user_id
      OR v_chair_id = v_user_id
    );
    v_allowed := v_is_owner OR v_is_manager;
  ELSIF p_operation = 'followup' THEN
    v_is_manager := (
      public.is_current_user_admin()
      OR v_created_by = v_user_id
      OR v_secretary_id = v_user_id
      OR v_chair_id = v_user_id
    );
    v_allowed := v_is_manager;
    IF NOT v_allowed THEN
      RAISE EXCEPTION 'MINUTES_DECISION_TRACKING_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF p_operation = 'obstacle' AND (p_event_title IS NULL OR btrim(p_event_title) = '') THEN
    RAISE EXCEPTION 'OBSTACLE_TITLE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF p_remind_at IS NOT NULL THEN
    IF p_remind_at <= now() THEN
      RAISE EXCEPTION 'REMINDER_MUST_BE_FUTURE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_event_type := CASE p_operation
    WHEN 'status_change' THEN 'status_change'
    WHEN 'followup' THEN 'followup'
    WHEN 'obstacle' THEN 'obstacle'
    WHEN 'obstacle_resolved' THEN 'obstacle_resolved'
    WHEN 'reopened' THEN 'reopened'
    WHEN 'completion' THEN 'completion'
  END;

  v_is_blocking := (p_operation = 'obstacle');
  v_new_status := v_decision.status;
  v_new_progress := v_decision.progress_percent;
  v_new_completed_at := v_decision.completed_at;

  IF p_operation = 'status_change' THEN
    IF p_new_status IS NULL THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_status NOT IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval','completed','stopped') THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := p_new_status;
    -- waiting_approval invariant: progress=100, completed_at=NULL
    IF v_new_status = 'waiting_approval' THEN
      v_new_progress := 100;
      v_new_completed_at := NULL;
    ELSIF p_new_status = 'completed' THEN
      v_new_progress := 100;
      v_new_completed_at := now();
    ELSIF p_new_status <> 'completed' THEN
      v_new_completed_at := NULL;
    END IF;
  ELSIF p_operation = 'completion' THEN
    IF v_decision.progress_percent < 100 THEN
      RAISE EXCEPTION 'COMPLETION_REQUIRES_100_PERCENT' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := 'completed';
    v_new_progress := 100;
    v_new_completed_at := now();
  ELSIF p_operation = 'reopened' THEN
    IF v_decision.status NOT IN ('completed','stopped') THEN
      RAISE EXCEPTION 'INVALID_REOPEN_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := 'in_progress';
    v_new_completed_at := NULL;
  END IF;

  IF v_decision.status = 'completed' AND p_operation NOT IN ('reopened','obstacle_resolved') THEN
    RAISE EXCEPTION 'COMPLETED_DECISION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  IF p_operation = 'obstacle_resolved' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.minutes_decision_updates u
      WHERE u.id = p_obstacle_update_id
      AND u.decision_id = p_decision_id
      AND u.event_type = 'obstacle'
      AND u.is_blocking = true
      AND u.resolved_at IS NULL
    ) INTO v_obstacle_exists;
    IF NOT v_obstacle_exists THEN
      RAISE EXCEPTION 'OBSTACLE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_new_updated_at := now();
  UPDATE public.minutes_decisions
  SET
    status = v_new_status,
    progress_percent = v_new_progress,
    completed_at = v_new_completed_at,
    latest_update = COALESCE(p_report_text, latest_update),
    updated_at = v_new_updated_at
  WHERE id = p_decision_id;

  INSERT INTO public.minutes_decision_updates (
    decision_id, minute_id, previous_status, new_status,
    previous_progress_percent, new_progress_percent,
    update_text, event_type, event_title, event_metadata, is_blocking,
    created_by_user_id
  ) VALUES (
    p_decision_id, v_minute_id, v_decision.status, v_new_status,
    v_decision.progress_percent, v_new_progress,
    COALESCE(p_report_text, p_event_title, ''),
    v_event_type, p_event_title, p_event_metadata, v_is_blocking, v_user_id
  )
  RETURNING id INTO v_update_id;

  IF p_operation = 'obstacle_resolved' THEN
    UPDATE public.minutes_decision_updates
    SET resolved_at = now(), resolved_by_user_id = v_user_id
    WHERE id = p_obstacle_update_id;
  END IF;

  IF p_remind_at IS NOT NULL THEN
    v_recipient := v_decision.primary_owner_user_id;
    IF v_recipient IS NULL THEN
      RAISE EXCEPTION 'NO_REMINDER_RECIPIENT' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.minutes_decision_reminders (
      decision_id, minute_id, recipient_user_id,
      remind_at, status, created_by_user_id, source_update_id
    ) VALUES (
      p_decision_id, v_minute_id, v_recipient,
      p_remind_at, 'pending', v_user_id, v_update_id
    );
  END IF;

  v_actor_name := COALESCE(
    (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles_public p WHERE p.user_id = v_user_id LIMIT 1),
    (SELECT NULLIF(btrim(p.username), '') FROM public.profiles_public p WHERE p.user_id = v_user_id LIMIT 1),
    'کاربر'
  );

  IF p_operation IN ('status_change','followup','reopened') THEN
    IF v_decision.primary_owner_user_id IS NOT NULL
       AND v_decision.primary_owner_user_id IS DISTINCT FROM v_user_id THEN
      v_owner_name := COALESCE(
        (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.user_id = v_decision.primary_owner_user_id LIMIT 1),
        'مسئول مصوبه'
      );

      v_notif_event_type := CASE p_operation
        WHEN 'status_change' THEN 'decision_status_changed'
        WHEN 'followup' THEN 'decision_followup'
        WHEN 'reopened' THEN 'decision_reopened'
      END;
      v_notif_title := CASE p_operation
        WHEN 'status_change' THEN 'تغییر وضعیت مصوبه'
        WHEN 'followup' THEN 'پیگیری مصوبه'
        WHEN 'reopened' THEN 'بازگشایی مصوبه'
      END;
      v_notif_msg := CASE p_operation
        WHEN 'status_change' THEN 'وضعیت مصوبه تغییر کرد: ' || v_decision.title
        WHEN 'followup' THEN 'پیگیری جدید برای مصوبه: ' || v_decision.title
        WHEN 'reopened' THEN 'مصوبه بازگشایی شد: ' || v_decision.title
      END;

      v_event_key := 'decision:' || p_decision_id::text || ':' || v_notif_event_type || ':' || v_update_id::text || ':' || v_decision.primary_owner_user_id::text;
      PERFORM public._create_minutes_notification(
        v_decision.primary_owner_user_id, v_notif_event_type, v_notif_title, v_notif_msg,
        'decision', p_decision_id, v_minute_id, v_revision, v_user_id,
        jsonb_build_object(
          'decision_id', p_decision_id, 'event_type', v_event_type,
          'decision_title', v_decision.title,
          'decision_status', v_new_status,
          'previous_decision_status', v_decision.status,
          'decision_progress', v_new_progress::text,
          'actor_name', v_actor_name,
          'owner_name', v_owner_name
        ),
        v_event_key
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'decision_id', p_decision_id,
    'status', v_new_status,
    'progress_percent', v_new_progress,
    'completed_at', v_new_completed_at,
    'updated_at', v_new_updated_at,
    'history_written', v_update_id IS NOT NULL
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.manage_minutes_decision TO authenticated;
