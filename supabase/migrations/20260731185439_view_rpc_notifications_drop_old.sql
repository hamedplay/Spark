-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: view RPC, notifications, drop old RPC, permission catalog
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Helper: _can_view_minute — check if current user can view a minute ────
-- Mirrors the minutes_select RLS policy logic for use inside RPCs.
CREATE OR REPLACE FUNCTION public._can_view_minute(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = p_minute_id
        AND (
          m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = p_minute_id
        AND m.confidentiality IN ('organizational','public')
        AND EXISTS (
          SELECT 1 FROM public.meetings mt
          WHERE mt.id = m.meeting_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = p_minute_id
        AND m.confidentiality = 'restricted'
        AND public.can_view_restricted_minutes_meeting(m.meeting_id)
    );
$$;

GRANT EXECUTE ON FUNCTION public._can_view_minute(uuid) TO authenticated;

-- ── 2. RPC: get_minutes_decisions_for_view (read-only, for detail/print/report) ─
CREATE OR REPLACE FUNCTION public.get_minutes_decisions_for_view(
  p_minute_id uuid
)
RETURNS TABLE (
  id                           uuid,
  title                        text,
  description                  text,
  priority                     text,
  status                       text,
  progress_percent             integer,
  start_date                   date,
  due_date                     date,
  responsible_unit_name_snapshot text,
  primary_owner_user_id        uuid,
  owner_name                   text,
  requires_followup            boolean,
  latest_update                text,
  agenda_result_id             uuid,
  agenda_title                 text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._can_view_minute(p_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.title,
    d.description,
    d.priority::text,
    d.status::text,
    d.progress_percent,
    d.start_date,
    d.due_date,
    d.responsible_unit_name_snapshot,
    d.primary_owner_user_id,
    COALESCE(p.full_name, p.username, d.primary_owner_user_id::text) AS owner_name,
    d.requires_followup,
    d.latest_update,
    d.agenda_result_id,
    ar.agenda_title_snapshot AS agenda_title
  FROM public.minutes_decisions d
  LEFT JOIN public.profiles_public p ON p.user_id = d.primary_owner_user_id
  LEFT JOIN public.minutes_agenda_results ar ON ar.id = d.agenda_result_id
  WHERE d.minute_id = p_minute_id
  ORDER BY d.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_minutes_decisions_for_view(uuid) TO authenticated;

-- ── 3. Add notifications to update_my_minutes_decision ─────────────────────
-- Replaces the function to add notification calls for obstacle and completion.
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
  v_update_id         uuid;
  v_recipient         uuid;
  v_seen              uuid[] := '{}'::uuid[];
  v_notif_event_type  text;
  v_notif_title       text;
  v_notif_msg         text;
  v_event_key         text;
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
    )
    RETURNING id INTO v_update_id;
  END IF;

  -- ── Notifications ──────────────────────────────────────────────────────
  -- obstacle: notify secretary, chair, creator
  IF v_event_type = 'obstacle' THEN
    v_notif_event_type := 'decision_obstacle';
    v_notif_title      := 'مانع جدید برای مصوبه';
    v_notif_msg        := 'مانع جدید ثبت شد: ' || COALESCE(v_event_title, v_decision.title);
  -- completion: notify secretary, chair, creator
  ELSIF v_event_type = 'completion' THEN
    v_notif_event_type := 'decision_completed';
    v_notif_title      := 'مصوبه تکمیل شد';
    v_notif_msg        := 'مصوبه تکمیل شد: ' || v_decision.title;
  -- obstacle_resolved: notify secretary, chair
  ELSIF v_event_type = 'obstacle_resolved' THEN
    v_notif_event_type := 'decision_obstacle_resolved';
    v_notif_title      := 'مانع مصوبه رفع شد';
    v_notif_msg        := 'مانع رفع شد: ' || v_decision.title;
  END IF;

  IF v_notif_event_type IS NOT NULL AND v_update_id IS NOT NULL THEN
    FOREACH v_recipient IN ARRAY ARRAY[v_secretary_id, v_chair_id, v_created_by] LOOP
      IF v_recipient IS NULL THEN CONTINUE; END IF;
      IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
      v_seen := array_append(v_seen, v_recipient);
      IF v_recipient IS DISTINCT FROM v_user_id THEN
        v_event_key := 'decision:' || p_decision_id::text || ':' || v_notif_event_type || ':' || v_update_id::text || ':' || v_recipient::text;
        PERFORM public._create_minutes_notification(
          v_recipient, v_notif_event_type, v_notif_title, v_notif_msg,
          'decision', p_decision_id, v_minute_id, v_revision, v_user_id,
          jsonb_build_object('decision_id', p_decision_id, 'event_type', v_event_type),
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

-- ── 4. Add notifications to manage_minutes_decision ────────────────────────
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
  v_update_id        uuid;
  v_recipient         uuid;
  v_seen              uuid[] := '{}'::uuid[];
  v_notif_event_type text;
  v_notif_title       text;
  v_notif_msg         text;
  v_event_key         text;
  v_msg_text          text;
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
  )
  RETURNING id INTO v_update_id;

  IF v_new_updated_at IS NULL THEN
    SELECT updated_at INTO v_new_updated_at FROM public.minutes_decisions WHERE id = p_decision_id;
  END IF;

  -- ── Notifications ──────────────────────────────────────────────────────
  -- status_change: notify primary owner
  IF p_operation = 'status_change' THEN
    v_notif_event_type := 'decision_status_changed';
    v_notif_title      := 'وضعیت مصوبه تغییر یافت';
    v_notif_msg        := 'وضعیت مصوبه تغییر کرد: ' || v_decision.title;
  ELSIF p_operation = 'followup' THEN
    v_notif_event_type := 'decision_followup';
    v_notif_title      := 'پیگیری جدید برای مصوبه';
    v_notif_msg        := 'پیگیری ثبت شد: ' || v_decision.title;
  ELSIF p_operation = 'reopened' THEN
    v_notif_event_type := 'decision_reopened';
    v_notif_title      := 'مصوبه بازگشایی شد';
    v_notif_msg        := 'مصوبه بازگشایی شد: ' || v_decision.title;
  ELSIF p_operation = 'obstacle' THEN
    v_notif_event_type := 'decision_obstacle';
    v_notif_title      := 'مانع جدید برای مصوبه';
    v_notif_msg        := 'مانع جدید ثبت شد: ' || COALESCE(p_event_title, v_decision.title);
  ELSIF p_operation = 'obstacle_resolved' THEN
    v_notif_event_type := 'decision_obstacle_resolved';
    v_notif_title      := 'مانع مصوبه رفع شد';
    v_notif_msg        := 'مانع رفع شد: ' || v_decision.title;
  ELSIF p_operation = 'completion' THEN
    v_notif_event_type := 'decision_completed';
    v_notif_title      := 'مصوبه تکمیل شد';
    v_notif_msg        := 'مصوبه تکمیل شد: ' || v_decision.title;
  END IF;

  IF v_notif_event_type IS NOT NULL AND v_update_id IS NOT NULL THEN
    -- Determine recipients based on operation
    IF p_operation IN ('status_change','followup','reopened') THEN
      -- Notify primary owner (if not the actor)
      IF v_decision.primary_owner_user_id IS NOT NULL
         AND v_decision.primary_owner_user_id IS DISTINCT FROM v_user_id THEN
        v_event_key := 'decision:' || p_decision_id::text || ':' || v_notif_event_type || ':' || v_update_id::text || ':' || v_decision.primary_owner_user_id::text;
        PERFORM public._create_minutes_notification(
          v_decision.primary_owner_user_id, v_notif_event_type, v_notif_title, v_notif_msg,
          'decision', p_decision_id, v_minute_id, v_revision, v_user_id,
          jsonb_build_object('decision_id', p_decision_id, 'operation', p_operation),
          v_event_key
        );
      END IF;
    ELSIF p_operation IN ('obstacle','obstacle_resolved','completion') THEN
      -- Notify secretary, chair, creator, and owner
      FOREACH v_recipient IN ARRAY ARRAY[
        v_secretary_id, v_chair_id, v_created_by, v_decision.primary_owner_user_id
      ] LOOP
        IF v_recipient IS NULL THEN CONTINUE; END IF;
        IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
        v_seen := array_append(v_seen, v_recipient);
        IF v_recipient IS DISTINCT FROM v_user_id THEN
          v_event_key := 'decision:' || p_decision_id::text || ':' || v_notif_event_type || ':' || v_update_id::text || ':' || v_recipient::text;
          PERFORM public._create_minutes_notification(
            v_recipient, v_notif_event_type, v_notif_title, v_notif_msg,
            'decision', p_decision_id, v_minute_id, v_revision, v_user_id,
            jsonb_build_object('decision_id', p_decision_id, 'operation', p_operation),
            v_event_key
          );
        END IF;
      END LOOP;
    END IF;
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

-- ── 5. Revoke + DROP old update_decision_progress ───────────────────────────
-- First revoke execute from all roles
REVOKE EXECUTE ON FUNCTION public.update_decision_progress(uuid, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_decision_progress(uuid, text, integer, text) FROM authenticated;

-- Drop the function
DROP FUNCTION IF EXISTS public.update_decision_progress(uuid, text, integer, text);

-- ── 6. Index for _can_view_minute lookups ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_minutes_decisions_minute_created
  ON public.minutes_decisions (minute_id, created_at);
