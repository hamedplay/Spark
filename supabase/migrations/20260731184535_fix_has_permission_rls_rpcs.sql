-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: fix _has_permission, tighten RLS, rewrite RPCs
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Fix _has_permission: use correct column name `level` ──────────────────
CREATE OR REPLACE FUNCTION public._has_permission(p_user_id uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_position_id uuid;
  v_pos_level   integer;
  v_group_grant boolean := false;
  v_level_grant boolean := false;
  v_pos_grant   boolean;
BEGIN
  -- Find primary position
  SELECT opm.position_id, op.level
  INTO v_position_id, v_pos_level
  FROM public.org_position_members opm
  JOIN public.org_positions op ON op.id = opm.position_id
  WHERE opm.user_id = p_user_id AND opm.is_primary = true
  LIMIT 1;

  -- 1. Position-level override (highest precedence)
  IF v_position_id IS NOT NULL THEN
    SELECT COALESCE(opp.granted, false) INTO v_pos_grant
    FROM public.org_position_permissions opp
    WHERE opp.position_id = v_position_id AND opp.permission_key = p_key
    LIMIT 1;
    IF FOUND THEN
      RETURN v_pos_grant;
    END IF;
  END IF;

  -- 2. User groups
  SELECT COALESCE(bool_or((g.permissions->>p_key)::boolean), false)
  INTO v_group_grant
  FROM public.user_group_members ugm
  JOIN public.user_groups g ON g.id = ugm.group_id
  WHERE ugm.user_id = p_user_id
    AND (g.permissions ? p_key);
  IF v_group_grant THEN RETURN true; END IF;

  -- 3. Org level permissions
  IF v_pos_level IS NOT NULL THEN
    SELECT COALESCE(olp.granted, false) INTO v_level_grant
    FROM public.org_level_permissions olp
    WHERE olp.level = v_pos_level AND olp.permission_key = p_key
    LIMIT 1;
    IF v_level_grant THEN RETURN true; END IF;
  END IF;

  RETURN false;
END;
$$;

-- ── 2. Tighten minutes_decisions SELECT policy ──────────────────────────────
DROP POLICY IF EXISTS minutes_decisions_select ON public.minutes_decisions;

CREATE POLICY minutes_decisions_select ON public.minutes_decisions
  FOR SELECT TO authenticated
  USING (
    primary_owner_user_id = auth.uid()
    OR public._can_track_decisions(minute_id)
  );

-- ── 3. update_my_minutes_decision (owner-only RPC) ──────────────────────────
CREATE OR REPLACE FUNCTION public.update_my_minutes_decision(
  p_decision_id         uuid,
  p_expected_updated_at timestamptz,
  p_progress_percent    integer  DEFAULT NULL,
  p_status              text     DEFAULT NULL,
  p_report_text         text     DEFAULT NULL,
  p_event_type          text     DEFAULT 'progress',
  p_event_title        text     DEFAULT NULL,
  p_event_metadata     jsonb    DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id           uuid := auth.uid();
  v_decision          public.minutes_decisions%ROWTYPE;
  v_minute_status     text;
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
  v_msg_text          text;
  v_diag_sqlstate     text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF v_event_type NOT IN ('progress','status_change','report','obstacle','obstacle_resolved','completion') THEN
    RAISE EXCEPTION 'INVALID_EVENT_TYPE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_decision
  FROM public.minutes_decisions WHERE id = p_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_decision.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'DECISION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  IF v_decision.primary_owner_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'NOT_DECISION_OWNER' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, id, secretary_user_id, chair_user_id, created_by_user_id, revision_number
  INTO v_minute_status, v_minute_id, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes WHERE id = v_decision.minute_id;

  IF v_minute_status NOT IN ('published', 'approved') THEN
    RAISE EXCEPTION 'MINUTE_NOT_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;

  IF v_decision.status = 'completed' AND v_event_type <> 'completion' THEN
    RAISE EXCEPTION 'COMPLETED_DECISION_IMMUTABLE' USING ERRCODE = 'P0001';
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

  -- Auto-determine event_type
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

  UPDATE public.minutes_decisions SET
    status           = v_new_status,
    progress_percent = v_new_progress,
    completed_at     = v_new_completed_at,
    latest_update    = COALESCE(p_report_text, latest_update),
    updated_at       = now()
  WHERE id = p_decision_id
  RETURNING updated_at INTO v_new_updated_at;

  IF v_is_meaningful OR v_event_type IN ('report','obstacle','obstacle_resolved','completion') THEN
    INSERT INTO public.minutes_decision_updates (
      decision_id, minute_id,
      previous_status, new_status,
      previous_progress_percent, new_progress_percent,
      update_text,
      event_type, event_title, event_metadata, is_blocking,
      created_by_user_id
    ) VALUES (
      p_decision_id, v_minute_id,
      v_decision.status, v_new_status,
      v_decision.progress_percent, v_new_progress,
      p_report_text,
      v_event_type, v_event_title, COALESCE(p_event_metadata, '{}'::jsonb), false,
      v_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'decision_id', p_decision_id,
    'status', v_new_status,
    'progress_percent', v_new_progress,
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
$$;

GRANT EXECUTE ON FUNCTION public.update_my_minutes_decision(uuid, timestamptz, integer, text, text, text, text, jsonb) TO authenticated;

-- ── 4. Rewrite manage_minutes_decision ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manage_minutes_decision(
  p_decision_id          uuid,
  p_expected_updated_at  timestamptz,
  p_operation            text,
  p_new_status           text     DEFAULT NULL,
  p_event_title          text     DEFAULT NULL,
  p_report_text          text     DEFAULT NULL,
  p_event_metadata       jsonb    DEFAULT '{}'::jsonb,
  p_obstacle_update_id   uuid     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_decision         public.minutes_decisions%ROWTYPE;
  v_minute_id        uuid;
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
  v_new_completed_at timestamptz;
  v_new_updated_at  timestamptz;
  v_obstacle_exists  boolean;
  v_msg_text         text;
  v_diag_sqlstate    text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_operation NOT IN ('status_change','followup','obstacle','obstacle_resolved','reopened','completion') THEN
    RAISE EXCEPTION 'INVALID_OPERATION' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_decision
  FROM public.minutes_decisions WHERE id = p_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_decision.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'DECISION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, secretary_user_id, chair_user_id, created_by_user_id, revision_number
  INTO v_minute_id, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes WHERE id = v_decision.minute_id;

  v_is_owner   := v_decision.primary_owner_user_id IS NOT DISTINCT FROM v_user_id;
  v_is_manager :=
    public.is_current_user_admin()
    OR v_secretary_id IS NOT DISTINCT FROM v_user_id
    OR v_chair_id    IS NOT DISTINCT FROM v_user_id
    OR v_created_by  IS NOT DISTINCT FROM v_user_id
    OR public._has_permission(v_user_id, 'minutes_decisions.track'::text);

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

  IF p_operation = 'status_change' THEN
    IF p_new_status IS NULL OR p_new_status NOT IN (
      'not_started','planned','in_progress','waiting_coordination',
      'waiting_approval','stopped'
    ) THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_status = 'completed' THEN
      RAISE EXCEPTION 'USE_COMPLETION_OPERATION' USING ERRCODE = 'P0001';
    END IF;
    IF v_decision.status = 'completed' THEN
      RAISE EXCEPTION 'USE_REOPEN_OPERATION' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := p_new_status;
    v_event_type := 'status_change';
    UPDATE public.minutes_decisions SET
      status = v_new_status, updated_at = now()
    WHERE id = p_decision_id
    RETURNING updated_at INTO v_new_updated_at;

  ELSIF p_operation = 'completion' THEN
    IF v_decision.status = 'completed' THEN
      RAISE EXCEPTION 'COMPLETED_DECISION_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    v_new_status  := 'completed';
    v_new_completed_at := now();
    v_event_type  := 'completion';
    UPDATE public.minutes_decisions SET
      status = 'completed',
      progress_percent = 100,
      completed_at = v_new_completed_at,
      latest_update = COALESCE(p_report_text, latest_update),
      updated_at = now()
    WHERE id = p_decision_id
    RETURNING updated_at INTO v_new_updated_at;

  ELSIF p_operation = 'reopened' THEN
    IF v_decision.status <> 'completed' THEN
      RAISE EXCEPTION 'DECISION_NOT_COMPLETED' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := COALESCE(p_new_status, 'in_progress');
    IF v_new_status NOT IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval') THEN
      RAISE EXCEPTION 'INVALID_REOPEN_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_event_type := 'reopened';
    UPDATE public.minutes_decisions SET
      status = v_new_status, completed_at = NULL, updated_at = now()
    WHERE id = p_decision_id
    RETURNING updated_at INTO v_new_updated_at;

  ELSIF p_operation = 'followup' THEN
    v_event_type := 'followup';

  ELSIF p_operation = 'obstacle' THEN
    v_event_type  := 'obstacle';
    v_is_blocking := true;

  ELSIF p_operation = 'obstacle_resolved' THEN
    v_event_type := 'obstacle_resolved';
    IF p_obstacle_update_id IS NULL THEN
      RAISE EXCEPTION 'OBSTACLE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.minutes_decision_updates
      WHERE id = p_obstacle_update_id
        AND decision_id = p_decision_id
        AND event_type = 'obstacle'
        AND is_blocking = true
        AND resolved_at IS NULL
    ) INTO v_obstacle_exists;

    IF NOT v_obstacle_exists THEN
      SELECT EXISTS(
        SELECT 1 FROM public.minutes_decision_updates
        WHERE id = p_obstacle_update_id
          AND decision_id = p_decision_id
          AND event_type = 'obstacle'
          AND is_blocking = true
          AND resolved_at IS NOT NULL
      ) INTO v_obstacle_exists;
      IF v_obstacle_exists THEN
        RAISE EXCEPTION 'OBSTACLE_ALREADY_RESOLVED' USING ERRCODE = 'P0001';
      ELSE
        RAISE EXCEPTION 'OBSTACLE_NOT_FOUND' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Only update resolved_at and resolved_by — do NOT change event_type
    UPDATE public.minutes_decision_updates SET
      resolved_at = now(),
      resolved_by_user_id = v_user_id
    WHERE id = p_obstacle_update_id
      AND decision_id = p_decision_id
      AND event_type = 'obstacle'
      AND is_blocking = true
      AND resolved_at IS NULL;
  END IF;

  -- Insert history event
  INSERT INTO public.minutes_decision_updates (
    decision_id, minute_id,
    previous_status, new_status,
    previous_progress_percent, new_progress_percent,
    update_text,
    event_type, event_title, event_metadata, is_blocking,
    created_by_user_id
  ) VALUES (
    p_decision_id, v_minute_id,
    v_decision.status,
    COALESCE(v_new_status, v_decision.status),
    v_decision.progress_percent,
    CASE WHEN p_operation = 'completion' THEN 100 ELSE v_decision.progress_percent END,
    p_report_text,
    v_event_type,
    p_event_title,
    CASE WHEN p_operation = 'obstacle_resolved' AND p_obstacle_update_id IS NOT NULL
         THEN jsonb_build_object('obstacle_update_id', p_obstacle_update_id, 'resolution_notes', COALESCE(p_report_text, ''))
         ELSE COALESCE(p_event_metadata, '{}'::jsonb)
    END,
    v_is_blocking,
    v_user_id
  );

  IF v_new_updated_at IS NULL THEN
    SELECT updated_at INTO v_new_updated_at FROM public.minutes_decisions WHERE id = p_decision_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'operation', p_operation,
    'decision_id', p_decision_id,
    'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
    RETURN jsonb_build_object('success', false, 'error_code', v_msg_text, 'message', v_msg_text);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
    RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
      'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در مدیریت مصوبه');
END;
$$;

GRANT EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid) TO authenticated;

-- ── 5. Enhanced get_my_minutes_decisions ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_minutes_decisions(
  p_status            text     DEFAULT NULL,
  p_priority          text     DEFAULT NULL,
  p_search            text     DEFAULT NULL,
  p_requires_followup boolean  DEFAULT NULL,
  p_deadline_state    text     DEFAULT NULL,
  p_due_from          date     DEFAULT NULL,
  p_due_to            date     DEFAULT NULL,
  p_limit             integer  DEFAULT 20,
  p_offset            integer  DEFAULT 0
)
RETURNS TABLE (
  id                           uuid,
  minute_id                    uuid,
  agenda_result_id             uuid,
  title                        text,
  description                  text,
  primary_owner_user_id        uuid,
  responsible_unit_id          uuid,
  responsible_unit_name_snapshot text,
  priority                     text,
  status                       text,
  progress_percent             integer,
  start_date                   date,
  due_date                     date,
  completed_at                 timestamptz,
  requires_followup            boolean,
  latest_update                text,
  created_by_user_id           uuid,
  created_at                   timestamptz,
  updated_at                   timestamptz,
  discussion_result            text,
  result_type                  text,
  additional_notes             text,
  minute_title                 text,
  minute_status                text,
  meeting_date_snapshot        text,
  overdue                      boolean,
  agenda_title                 text,
  total_count                  bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.get_my_minutes_decisions(text, text, text, boolean, text, date, date, integer, integer) TO authenticated;

-- ── 6. get_trackable_minutes_decisions (manager view) ───────────────────────
CREATE OR REPLACE FUNCTION public.get_trackable_minutes_decisions(
  p_search              text     DEFAULT NULL,
  p_meeting_id          uuid     DEFAULT NULL,
  p_owner_user_id       uuid     DEFAULT NULL,
  p_responsible_unit_id uuid     DEFAULT NULL,
  p_status              text     DEFAULT NULL,
  p_priority            text     DEFAULT NULL,
  p_requires_followup   boolean  DEFAULT NULL,
  p_has_open_obstacle   boolean  DEFAULT NULL,
  p_deadline_state      text     DEFAULT NULL,
  p_start_from          date     DEFAULT NULL,
  p_start_to            date     DEFAULT NULL,
  p_due_from            date     DEFAULT NULL,
  p_due_to              date     DEFAULT NULL,
  p_limit               integer  DEFAULT 25,
  p_offset              integer  DEFAULT 0
)
RETURNS TABLE (
  id                           uuid,
  minute_id                    uuid,
  title                        text,
  description                  text,
  primary_owner_user_id        uuid,
  owner_name                   text,
  responsible_unit_id          uuid,
  responsible_unit_name_snapshot text,
  priority                     text,
  status                       text,
  progress_percent             integer,
  start_date                   date,
  due_date                     date,
  completed_at                 timestamptz,
  requires_followup            boolean,
  latest_update                text,
  latest_followup_at           timestamptz,
  open_obstacle_count          integer,
  updated_at                   timestamptz,
  minute_title                 text,
  minute_status                text,
  meeting_date_snapshot        text,
  overdue                      boolean,
  total_count                  bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today   text := to_char(now() AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

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
      m.meeting_title_snapshot   AS minute_title,
      m.status::text             AS minute_status,
      m.meeting_date_snapshot    AS meeting_date_snapshot,
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
        p_deadline_state IS NULL OR p_deadline_state = 'all' OR
        (p_deadline_state = 'overdue' AND d.due_date IS NOT NULL AND d.due_date < v_today::date AND d.status NOT IN ('completed','stopped')) OR
        (p_deadline_state = 'due_today' AND d.due_date = v_today::date AND d.status NOT IN ('completed','stopped')) OR
        (p_deadline_state = 'due_soon' AND d.due_date IS NOT NULL AND d.due_date > v_today::date AND d.due_date <= (v_today::date + 3) AND d.status NOT IN ('completed','stopped')) OR
        (p_deadline_state = 'on_track' AND d.due_date IS NOT NULL AND d.due_date > (v_today::date + 3) AND d.status NOT IN ('completed','stopped')) OR
        (p_deadline_state = 'no_due_date' AND d.due_date IS NULL) OR
        (p_deadline_state = 'completed' AND d.status = 'completed')
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
  counted AS (SELECT COUNT(*) AS cnt FROM decision_base)
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
    db.overdue,
    c.cnt::bigint AS total_count
  FROM decision_base db
  LEFT JOIN owner_names on_p ON on_p.primary_owner_user_id = db.primary_owner_user_id
  LEFT JOIN followup_agg fa ON fa.decision_id = db.id
  LEFT JOIN obstacle_agg oa ON oa.decision_id = db.id
  CROSS JOIN counted c
  WHERE (p_has_open_obstacle IS NULL OR p_has_open_obstacle = false OR COALESCE(oa.open_count, 0) > 0)
  ORDER BY
    db.overdue DESC,
    CASE WHEN db.due_date = v_today::date THEN 0 ELSE 1 END,
    CASE WHEN db.due_date IS NOT NULL AND db.due_date <= (v_today::date + 3) THEN 0 ELSE 1 END,
    CASE db.priority
      WHEN 'urgent'    THEN 1
      WHEN 'important' THEN 2
      WHEN 'normal'    THEN 3
      WHEN 'low'       THEN 4
      ELSE 5
    END,
    db.due_date ASC NULLS LAST,
    db.updated_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trackable_minutes_decisions(text, uuid, uuid, uuid, text, text, boolean, boolean, text, date, date, date, date, integer, integer) TO authenticated;

-- ── 7. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_minutes_decisions_priority
  ON public.minutes_decisions (priority);

CREATE INDEX IF NOT EXISTS idx_minutes_decisions_due_date
  ON public.minutes_decisions (due_date)
  WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_minutes_decisions_requires_followup
  ON public.minutes_decisions (requires_followup)
  WHERE requires_followup = true;

CREATE INDEX IF NOT EXISTS idx_mdu_event_type
  ON public.minutes_decision_updates (decision_id, event_type, created_at DESC);
