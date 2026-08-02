-- Fix three regressions in the minutes module
-- 1. Incomplete document template (attendance, delegate, agenda, approvers)
-- 2. Submit-for-approval failure (delegate-attended approver support)
-- 3. Decisions visible before publication (publication gate enforcement)

-- Add delegate_name column to minutes_participants
ALTER TABLE public.minutes_participants
  ADD COLUMN IF NOT EXISTS delegate_name text;

COMMENT ON COLUMN public.minutes_participants.delegate_name IS
  'Name of the delegate representing an absent internal participant. NULL when no delegate was appointed.';

-- _can_track_decisions: Add publication gate
CREATE OR REPLACE FUNCTION public._can_track_decisions(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.minutes m
    WHERE m.id = p_minute_id
    AND m.status = 'published'
    AND m.published_at IS NOT NULL
    AND m.secretary_user_id = auth.uid()
  );
$function$;

-- get_my_minutes_decisions: Add publication gate (exact same signature)
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
RETURNS TABLE (
  id uuid,
  minute_id uuid,
  agenda_result_id uuid,
  title text,
  description text,
  primary_owner_user_id uuid,
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
  created_by_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  discussion_result text,
  result_type text,
  additional_notes text,
  minute_title text,
  minute_status text,
  meeting_date_snapshot text,
  overdue boolean,
  agenda_title text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today   text := to_char(now() AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

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
      m.meeting_title_snapshot   AS minute_title,
      m.status::text             AS minute_status,
      m.meeting_date_snapshot    AS meeting_date_snapshot,
      (d.due_date IS NOT NULL AND d.due_date < v_today::date
       AND d.status NOT IN ('completed','stopped')) AS overdue,
      ar.agenda_title_snapshot  AS agenda_title
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
      p_deadline_state IS NULL OR p_deadline_state = 'all' OR
      (p_deadline_state = 'overdue' AND d.due_date IS NOT NULL AND d.due_date < v_today::date AND d.status NOT IN ('completed','stopped')) OR
      (p_deadline_state = 'due_today' AND d.due_date = v_today::date AND d.status NOT IN ('completed','stopped')) OR
      (p_deadline_state = 'due_soon' AND d.due_date IS NOT NULL AND d.due_date > v_today::date AND d.due_date <= (v_today::date + 3) AND d.status NOT IN ('completed','stopped')) OR
      (p_deadline_state = 'on_track' AND d.due_date IS NOT NULL AND d.due_date > (v_today::date + 3) AND d.status NOT IN ('completed','stopped')) OR
      (p_deadline_state = 'no_due_date' AND d.due_date IS NULL) OR
      (p_deadline_state = 'completed' AND d.status = 'completed')
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

-- get_my_minutes_decisions_summary: Add publication gate
CREATE OR REPLACE FUNCTION public.get_my_minutes_decisions_summary()
RETURNS TABLE (
  total_count integer,
  active_count integer,
  completed_count integer,
  stopped_count integer,
  overdue_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::integer AS total_count,
    COUNT(*) FILTER (WHERE status IN ('planned','in_progress','waiting_coordination','waiting_approval'))::integer AS active_count,
    COUNT(*) FILTER (WHERE status = 'completed')::integer AS completed_count,
    COUNT(*) FILTER (WHERE status = 'stopped')::integer AS stopped_count,
    COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < current_date
      AND status NOT IN ('completed','stopped'))::integer AS overdue_count
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE d.primary_owner_user_id = v_user_id
  AND m.status = 'published'
  AND m.published_at IS NOT NULL;
END;
$function$;

-- get_my_minutes_hub_counts: Add publication gate
CREATE OR REPLACE FUNCTION public.get_my_minutes_hub_counts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_minutes_unread int;
  v_approvals_pending int;
  v_my_decisions_unread int;
  v_my_decisions_active int;
  v_followup_actionable int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object(
      'minutes_unread', 0, 'approvals_pending', 0,
      'my_decisions_unread', 0, 'my_decisions_active', 0,
      'followup_actionable', 0
    );
  END IF;

  SELECT count(*) INTO v_minutes_unread
  FROM public.notifications
  WHERE user_id = v_user_id AND read = false
  AND (template_category = 'minutes' OR (template_category IS NULL AND entity_type = 'minute'));

  SELECT count(*) INTO v_approvals_pending
  FROM public.minutes_approvals ma
  JOIN public.minutes m ON m.id = ma.minute_id
  WHERE ma.approver_user_id = v_user_id AND ma.status = 'pending'
  AND ma.revision_number = m.revision_number AND m.status = 'pending_approval';

  SELECT count(*) INTO v_my_decisions_unread
  FROM public.notifications
  WHERE user_id = v_user_id AND read = false
  AND (template_category = 'decision' OR (template_category IS NULL AND entity_type = 'decision'));

  SELECT count(*) INTO v_my_decisions_active
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE d.primary_owner_user_id = v_user_id
  AND d.status NOT IN ('completed', 'stopped')
  AND m.status = 'published' AND m.published_at IS NOT NULL;

  SELECT count(DISTINCT d.id) INTO v_followup_actionable
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE d.primary_owner_user_id = v_user_id
  AND d.status NOT IN ('completed', 'stopped')
  AND m.status = 'published' AND m.published_at IS NOT NULL
  AND (
    EXISTS (SELECT 1 FROM public.minutes_decision_reminders r
      WHERE r.decision_id = d.id AND r.recipient_user_id = v_user_id
      AND r.status = 'pending' AND r.remind_at <= now())
    OR (d.due_date IS NOT NULL AND d.due_date::date < now()::date)
  );

  RETURN json_build_object(
    'minutes_unread', v_minutes_unread,
    'approvals_pending', v_approvals_pending,
    'my_decisions_unread', v_my_decisions_unread,
    'my_decisions_active', v_my_decisions_active,
    'followup_actionable', v_followup_actionable
  );
END;
$function$;

-- get_minutes_decisions_for_view: Add publication gate
CREATE OR REPLACE FUNCTION public.get_minutes_decisions_for_view(p_minute_id uuid)
RETURNS TABLE (
  id uuid, title text, description text, priority text, status text,
  progress_percent integer, start_date date, due_date date,
  responsible_unit_name_snapshot text, primary_owner_user_id uuid,
  owner_name text, requires_followup boolean, latest_update text,
  agenda_result_id uuid, agenda_title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_minute_status text;
  v_minute_published_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._can_view_minute(p_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  SELECT m.status, m.published_at INTO v_minute_status, v_minute_published_at
  FROM public.minutes m WHERE m.id = p_minute_id;
  IF v_minute_status IS NULL THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_minute_status <> 'published' OR v_minute_published_at IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT d.id, d.title, d.description, d.priority::text, d.status::text,
    d.progress_percent, d.start_date, d.due_date,
    d.responsible_unit_name_snapshot, d.primary_owner_user_id,
    COALESCE(p.full_name, p.username, d.primary_owner_user_id::text),
    d.requires_followup, d.latest_update, d.agenda_result_id,
    ar.agenda_title_snapshot
  FROM public.minutes_decisions d
  LEFT JOIN public.profiles_public p ON p.user_id = d.primary_owner_user_id
  LEFT JOIN public.minutes_agenda_results ar ON ar.id = d.agenda_result_id
  WHERE d.minute_id = p_minute_id
  ORDER BY d.created_at ASC;
END;
$function$;

-- update_my_minutes_decision: Tighten publication gate (exact same signature)
CREATE OR REPLACE FUNCTION public.update_my_minutes_decision(
  p_decision_id uuid,
  p_expected_updated_at timestamptz,
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
  IF v_decision.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'DECISION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF v_decision.primary_owner_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'NOT_DECISION_OWNER' USING ERRCODE = 'P0001';
  END IF;
  SELECT status, published_at, id, secretary_user_id, chair_user_id, created_by_user_id, revision_number
  INTO v_minute_status, v_minute_published_at, v_minute_id, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes WHERE id = v_decision.minute_id;
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
  IF v_event_type = 'completion' THEN
    v_new_progress := 100;
    v_new_status   := 'completed';
    v_event_title  := COALESCE(v_event_title, 'تکمیل مصوبه');
  ELSIF v_new_status = 'completed' AND v_event_type <> 'completion' THEN
    RAISE EXCEPTION 'USE_COMPLETION_OPERATION' USING ERRCODE = 'P0001';
  END IF;
  IF v_new_status = 'completed' AND v_new_progress <> 100 THEN
    RAISE EXCEPTION 'COMPLETION_REQUIRES_100_PERCENT' USING ERRCODE = 'P0001';
  END IF;
  v_new_completed_at := CASE WHEN v_new_status = 'completed' THEN now() ELSE NULL END;
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
    status = v_new_status, progress_percent = v_new_progress,
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
            'obstacle_severity', CASE WHEN v_is_blocking THEN 'blocking' ELSE 'minor' END,
            'decision_link', '#minutes-my-decisions?decision=' || p_decision_id::text,
            'actor_name', v_actor_name, 'audience', v_audience
          ), v_event_key
        );
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object(
    'success', true, 'decision_id', p_decision_id,
    'status', v_new_status, 'progress_percent', v_new_progress,
    'completed_at', v_new_completed_at,
    'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'history_written', v_is_meaningful OR v_event_type IN ('report','obstacle','obstacle_resolved','completion')
  );
  EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
    RETURN jsonb_build_object('success', false, 'error_code', v_msg_text, 'message', v_msg_text);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
    RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
      'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در به‌روزرسانی مصوبه');
END;
$function$;

-- manage_minutes_decision: Add publication gate (exact same signature)
CREATE OR REPLACE FUNCTION public.manage_minutes_decision(
  p_decision_id uuid,
  p_expected_updated_at timestamptz,
  p_operation text,
  p_new_status text DEFAULT NULL,
  p_event_title text DEFAULT NULL,
  p_report_text text DEFAULT NULL,
  p_event_metadata jsonb DEFAULT '{}'::jsonb,
  p_obstacle_update_id uuid DEFAULT NULL,
  p_remind_at timestamptz DEFAULT NULL
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
  v_revision        integer;
  v_is_owner         boolean;
  v_is_manager       boolean;
  v_allowed          boolean := false;
  v_event_type       text;
  v_is_blocking      boolean := false;
  v_new_status       text;
  v_new_completed_at timestamptz;
  v_new_updated_at  timestamptz;
  v_obstacle_exists  boolean;
  v_update_id        uuid;
  v_recipient         uuid;
  v_audience          text;
  v_seen              uuid[] := '{}'::uuid[];
  v_notif_event_type text;
  v_notif_title       text;
  v_notif_msg         text;
  v_event_key         text;
  v_msg_text          text;
  v_remind_at_tz     timestamptz;
  v_actor_name       text;
  v_owner_name       text;
  v_obstacle_title   text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF p_operation NOT IN ('status_change','followup','obstacle','obstacle_resolved','reopened','completion') THEN
    RAISE EXCEPTION 'INVALID_OPERATION' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_decision FROM public.minutes_decisions WHERE id = p_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_decision.updated_at IS NOT NULL
  AND v_decision.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'DECISION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  SELECT id, status, published_at, secretary_user_id, chair_user_id, created_by_user_id, revision_number
  INTO v_minute_id, v_minute_status, v_minute_published_at, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes WHERE id = v_decision.minute_id;
  IF v_minute_status <> 'published' OR v_minute_published_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MINUTES_NOT_PUBLISHED',
      'message', 'این مصوبه تا زمان انتشار صورت‌جلسه قابل مشاهده یا پیگیری نیست.');
  END IF;
  v_is_owner := v_decision.primary_owner_user_id IS NOT DISTINCT FROM v_user_id;
  v_is_manager := v_secretary_id IS NOT DISTINCT FROM v_user_id;
  IF p_operation IN ('obstacle', 'obstacle_resolved', 'completion') THEN
    v_allowed := v_is_owner OR v_is_manager;
  ELSIF p_operation IN ('status_change', 'followup', 'reopened') THEN
    v_allowed := v_is_manager;
  ELSE
    v_allowed := false;
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  IF p_operation = 'obstacle' THEN
    v_obstacle_title := COALESCE(p_event_title, p_event_metadata->>'obstacle_title');
    IF v_obstacle_title IS NULL OR btrim(v_obstacle_title) = '' THEN
      RAISE EXCEPTION 'OBSTACLE_TITLE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_remind_at IS NOT NULL THEN
    v_remind_at_tz := p_remind_at AT TIME ZONE 'Asia/Tehran';
    IF v_remind_at_tz <= now() THEN
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
  v_new_status := v_decision.status::text;
  v_new_completed_at := v_decision.completed_at;
  IF p_operation = 'status_change' THEN
    IF p_new_status IS NULL THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_status NOT IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval','completed','stopped') THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := p_new_status;
    IF p_new_status = 'completed' THEN v_new_completed_at := now();
    ELSIF p_new_status <> 'completed' THEN v_new_completed_at := NULL;
    END IF;
  ELSIF p_operation = 'completion' THEN
    IF v_decision.progress_percent < 100 THEN
      RAISE EXCEPTION 'COMPLETION_REQUIRES_100_PERCENT' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := 'completed';
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
    SELECT EXISTS(SELECT 1 FROM public.minutes_decision_updates
      WHERE id = p_obstacle_update_id AND decision_id = p_decision_id
      AND event_type = 'obstacle' AND is_blocking = true AND resolved_at IS NULL
    ) INTO v_obstacle_exists;
    IF NOT v_obstacle_exists THEN
      RAISE EXCEPTION 'OBSTACLE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  v_new_updated_at := now();
  UPDATE public.minutes_decisions
  SET status = v_new_status::public.decision_status,
    completed_at = v_new_completed_at,
    latest_update = COALESCE(p_report_text, v_decision.latest_update),
    updated_at = v_new_updated_at
  WHERE id = p_decision_id;
  INSERT INTO public.minutes_decision_updates (
    decision_id, minute_id, previous_status, new_status,
    previous_progress_percent, new_progress_percent,
    update_text, event_type, event_title, event_metadata, is_blocking,
    created_by_user_id
  ) VALUES (
    p_decision_id, v_minute_id, v_decision.status::text, v_new_status,
    v_decision.progress_percent, v_decision.progress_percent,
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
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles_public WHERE user_id = v_user_id LIMIT 1),
    (SELECT NULLIF(btrim(username), '') FROM public.profiles_public WHERE user_id = v_user_id LIMIT 1),
    'کاربر'
  );
  IF p_operation IN ('status_change','followup','reopened') THEN
    IF v_decision.primary_owner_user_id IS NOT NULL
    AND v_decision.primary_owner_user_id IS DISTINCT FROM v_user_id THEN
      v_owner_name := COALESCE(
        (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_decision.primary_owner_user_id LIMIT 1),
        'مسئول مصوبه'
      );
      v_event_key := 'decision:' || p_decision_id::text || ':' || v_event_type || ':' || v_update_id::text || ':' || v_decision.primary_owner_user_id::text;
      v_notif_event_type := CASE p_operation
        WHEN 'status_change' THEN 'decision_status_changed'
        WHEN 'followup' THEN 'decision_followup_logged'
        WHEN 'reopened' THEN 'decision_reopened'
      END;
      v_notif_title := CASE p_operation
        WHEN 'status_change' THEN 'تغییر وضعیت مصوبه'
        WHEN 'followup' THEN 'پیگیری مصوبه'
        WHEN 'reopened' THEN 'بازگشایی مصوبه'
      END;
      v_notif_msg := v_actor_name || ' — ' || COALESCE(v_decision.title, 'مصوبه');
      PERFORM public._create_minutes_notification(
        v_decision.primary_owner_user_id, v_notif_event_type, v_notif_title, v_notif_msg,
        'decision', p_decision_id, v_minute_id, v_revision
      );
    END IF;
  END IF;
  IF p_operation IN ('obstacle','obstacle_resolved','completion') THEN
    FOREACH v_recipient IN ARRAY ARRAY[
      v_decision.primary_owner_user_id, v_created_by, v_secretary_id, v_chair_id
    ] LOOP
      IF v_recipient IS NULL THEN CONTINUE; END IF;
      IF v_recipient = v_user_id THEN CONTINUE; END IF;
      IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
      v_seen := array_append(v_seen, v_recipient);
      v_audience := CASE
        WHEN v_recipient = v_decision.primary_owner_user_id THEN 'decision_owner'
        WHEN v_recipient = v_created_by THEN 'creator'
        WHEN v_recipient = v_secretary_id THEN 'secretary'
        WHEN v_recipient = v_chair_id THEN 'chair'
        ELSE 'other'
      END;
      v_notif_event_type := CASE p_operation
        WHEN 'obstacle' THEN 'decision_obstacle'
        WHEN 'obstacle_resolved' THEN 'decision_obstacle_resolved'
        WHEN 'completion' THEN 'decision_completed'
      END;
      v_notif_title := CASE p_operation
        WHEN 'obstacle' THEN 'ثبت مانع برای مصوبه'
        WHEN 'obstacle_resolved' THEN 'رفع مانع مصوبه'
        WHEN 'completion' THEN 'تکمیل مصوبه'
      END;
      v_notif_msg := v_actor_name || ' — ' || COALESCE(v_decision.title, 'مصوبه');
      PERFORM public._create_minutes_notification(
        v_recipient, v_notif_event_type, v_notif_title, v_notif_msg,
        'decision', p_decision_id, v_minute_id, v_revision
      );
    END LOOP;
  END IF;
  RETURN jsonb_build_object(
    'success', true, 'updated_at', v_new_updated_at::text,
    'new_status', v_new_status, 'update_id', v_update_id::text
  );
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
      RETURN jsonb_build_object('success', false, 'error_code', v_msg_text, 'message', v_msg_text);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
        'message', 'خطای داخلی در مدیریت مصوبه');
END;
$function$;

-- claim_due_minutes_decision_reminders: Add publication gate (exact same signature with DEFAULT)
CREATE OR REPLACE FUNCTION public.claim_due_minutes_decision_reminders(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  decision_id uuid,
  minute_id uuid,
  recipient_user_id uuid,
  decision_title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_stuck_threshold timestamptz := now() - interval '10 minutes';
  v_claimed_ids uuid[];
BEGIN
  SELECT array_agg(sub.rid) INTO v_claimed_ids
  FROM (
    SELECT r.id AS rid
    FROM public.minutes_decision_reminders r
    JOIN public.minutes_decisions d ON d.id = r.decision_id
    JOIN public.minutes m ON m.id = d.minute_id
    WHERE (
      (r.status = 'pending' AND r.remind_at <= now())
      OR (r.status = 'processing' AND r.updated_at < v_stuck_threshold)
    )
    AND m.status = 'published'
    AND m.published_at IS NOT NULL
    ORDER BY r.remind_at ASC
    LIMIT LEAST(p_limit, 100)
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.minutes_decision_reminders r
  SET status = 'processing', updated_at = now()
  WHERE r.id = ANY(v_claimed_ids);

  RETURN QUERY
  SELECT r.id, r.decision_id, r.minute_id, r.recipient_user_id, d.title AS decision_title
  FROM public.minutes_decision_reminders r
  JOIN public.minutes_decisions d ON d.id = r.decision_id
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE r.id = ANY(v_claimed_ids)
  AND m.status = 'published'
  AND m.published_at IS NOT NULL
  ORDER BY r.remind_at ASC;
END;
$function$;

-- claim_due_overdue_decisions: Tighten to published only (exact same signature with DEFAULT)
CREATE OR REPLACE FUNCTION public.claim_due_overdue_decisions(p_lead_days integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tehran')::date;
  v_due_soon_date date := v_today + p_lead_days;
  v_idempotency text;
  v_context jsonb;
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT d.id AS decision_id, d.primary_owner_user_id, d.title, d.due_date,
      d.minute_id AS minute_id, m.meeting_title_snapshot AS minute_title
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    WHERE d.status NOT IN ('completed', 'stopped')
    AND d.primary_owner_user_id IS NOT NULL
    AND d.due_date = v_due_soon_date
    AND m.status = 'published'
    AND m.published_at IS NOT NULL
  LOOP
    v_idempotency := 'decision:' || v_rec.decision_id::text || ':decision_due_soon:' || v_today::text || ':' || v_rec.primary_owner_user_id::text;
    v_context := jsonb_build_object(
      'decision_title', v_rec.title,
      'decision_due_date', v_rec.due_date::text,
      'minute_title', COALESCE(v_rec.minute_title, ''),
      'decision_link', '#minutes-my-decisions?decision=' || v_rec.decision_id::text,
      'audience', 'decision_owner'
    );
    PERFORM public.resolve_and_queue_notification(
      'decision_due_soon', v_rec.primary_owner_user_id, 'decision_owner',
      'decision', v_rec.decision_id, v_rec.minute_id, NULL, v_context, v_idempotency, NULL
    );
  END LOOP;
  FOR v_rec IN
    SELECT d.id AS decision_id, d.primary_owner_user_id, d.title, d.due_date,
      d.minute_id AS minute_id, m.meeting_title_snapshot AS minute_title
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    WHERE d.status NOT IN ('completed', 'stopped')
    AND d.primary_owner_user_id IS NOT NULL
    AND d.due_date < v_today
    AND m.status = 'published'
    AND m.published_at IS NOT NULL
  LOOP
    v_idempotency := 'decision:' || v_rec.decision_id::text || ':decision_overdue:' || v_today::text || ':' || v_rec.primary_owner_user_id::text;
    v_context := jsonb_build_object(
      'decision_title', v_rec.title,
      'decision_due_date', v_rec.due_date::text,
      'minute_title', COALESCE(v_rec.minute_title, ''),
      'decision_link', '#minutes-my-decisions?decision=' || v_rec.decision_id::text,
      'audience', 'decision_owner'
    );
    PERFORM public.resolve_and_queue_notification(
      'decision_overdue', v_rec.primary_owner_user_id, 'decision_owner',
      'decision', v_rec.decision_id, v_rec.minute_id, NULL, v_context, v_idempotency, NULL
    );
  END LOOP;
END;
$function$;

-- Preserve EXECUTE grants (authenticated only)
GRANT EXECUTE ON FUNCTION public._can_track_decisions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_minutes_decisions(text, text, text, boolean, text, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_minutes_decisions_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_minutes_hub_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_minutes_decisions_for_view(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_minutes_decision(uuid, timestamptz, integer, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_minutes_decision_reminders(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_overdue_decisions(integer) TO authenticated;
