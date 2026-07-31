-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: drop old overloads, fix is_blocking, add summary RPCs, has_any_trackable
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Drop old overload: manage_minutes_decision(uuid, text, text, text, text, jsonb, uuid) ─
REVOKE EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, text, text, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, text, text, text, text, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, text, text, text, text, jsonb, uuid) FROM authenticated;
DROP FUNCTION IF EXISTS public.manage_minutes_decision(uuid, text, text, text, text, jsonb, uuid);

-- ── 2. Drop old overload: get_my_minutes_decisions(text, integer, integer) ────
REVOKE EXECUTE ON FUNCTION public.get_my_minutes_decisions(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_minutes_decisions(text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_minutes_decisions(text, integer, integer) FROM authenticated;
DROP FUNCTION IF EXISTS public.get_my_minutes_decisions(text, integer, integer);

-- ── 3. Fix update_my_minutes_decision: is_blocking for obstacle events ─────────
-- Recreate with is_blocking = CASE WHEN v_event_type = 'obstacle' THEN true ELSE false END
CREATE OR REPLACE FUNCTION public.update_my_minutes_decision(
  p_decision_id         uuid,
  p_expected_updated_at timestamptz,
  p_progress_percent    integer  DEFAULT NULL,
  p_status              text     DEFAULT NULL,
  p_report_text         text     DEFAULT NULL,
  p_event_type          text     DEFAULT 'progress',
  p_event_title         text     DEFAULT NULL,
  p_event_metadata      jsonb    DEFAULT '{}'::jsonb
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
  v_is_blocking       boolean := false;
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

  -- Determine if this is a meaningful change
  IF v_decision.status IS DISTINCT FROM v_new_status
     OR v_decision.progress_percent IS DISTINCT FROM v_new_progress
     OR COALESCE(p_report_text, '') IS DISTINCT FROM COALESCE(v_decision.latest_update, '')
  THEN
    v_is_meaningful := true;
  END IF;

  -- Auto-detect event_type for progress events
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

  -- Set is_blocking for obstacle events
  v_is_blocking := (v_event_type = 'obstacle');

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
      v_event_type, v_event_title, COALESCE(p_event_metadata, '{}'::jsonb), v_is_blocking,
      v_user_id
    )
    RETURNING id INTO v_update_id;
  END IF;

  -- ── Notifications ──────────────────────────────────────────────────────
  IF v_event_type = 'obstacle' THEN
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

-- ── 4. Add obstacle_resolved operation to update_my_minutes_decision ─────────
-- (Already handled in the function above via p_event_type = 'obstacle_resolved')
-- But owner needs to resolve their own obstacles. Add logic for that:
-- The function already accepts 'obstacle_resolved' event_type. When called with
-- obstacle_resolved, it will create a history record. But we also need to mark
-- the original obstacle as resolved. This is handled by manage_minutes_decision
-- for managers. For owners, we add a separate helper RPC.

CREATE OR REPLACE FUNCTION public.resolve_my_minutes_decision_obstacle(
  p_decision_id          uuid,
  p_expected_updated_at  timestamptz,
  p_obstacle_update_id   uuid,
  p_resolution_notes     text DEFAULT NULL
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
  v_obstacle_exists  boolean;
  v_new_updated_at  timestamptz;
  v_update_id        uuid;
  v_recipient        uuid;
  v_seen             uuid[] := '{}'::uuid[];
  v_event_key        text;
  v_msg_text         text;
  v_diag_sqlstate    text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
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

  SELECT id, secretary_user_id, chair_user_id, created_by_user_id, revision_number
  INTO v_minute_id, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes WHERE id = v_decision.minute_id;

  -- Verify obstacle exists, belongs to this decision, is blocking, and unresolved
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

  -- Mark the original obstacle as resolved
  UPDATE public.minutes_decision_updates SET
    resolved_at = now(),
    resolved_by_user_id = v_user_id
  WHERE id = p_obstacle_update_id
    AND decision_id = p_decision_id
    AND event_type = 'obstacle'
    AND is_blocking = true
    AND resolved_at IS NULL;

  -- Update decision timestamp
  UPDATE public.minutes_decisions SET updated_at = now()
  WHERE id = p_decision_id
  RETURNING updated_at INTO v_new_updated_at;

  -- Create obstacle_resolved event
  INSERT INTO public.minutes_decision_updates (
    decision_id, minute_id,
    previous_status, new_status,
    previous_progress_percent, new_progress_percent,
    update_text,
    event_type, event_title, event_metadata, is_blocking,
    created_by_user_id
  ) VALUES (
    p_decision_id, v_minute_id,
    v_decision.status, v_decision.status,
    v_decision.progress_percent, v_decision.progress_percent,
    p_resolution_notes,
    'obstacle_resolved', 'رفع مانع',
    jsonb_build_object('obstacle_update_id', p_obstacle_update_id, 'resolution_notes', COALESCE(p_resolution_notes, '')),
    false,
    v_user_id
  )
  RETURNING id INTO v_update_id;

  -- Notify secretary, chair, creator
  FOREACH v_recipient IN ARRAY ARRAY[v_secretary_id, v_chair_id, v_created_by] LOOP
    IF v_recipient IS NULL THEN CONTINUE; END IF;
    IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_recipient);
    IF v_recipient IS DISTINCT FROM v_user_id THEN
      v_event_key := 'decision:' || p_decision_id::text || ':decision_obstacle_resolved:' || v_update_id::text || ':' || v_recipient::text;
      PERFORM public._create_minutes_notification(
        v_recipient, 'decision_obstacle_resolved', 'مانع مصوبه رفع شد',
        'مانع رفع شد: ' || v_decision.title,
        'decision', p_decision_id, v_minute_id, v_revision, v_user_id,
        jsonb_build_object('decision_id', p_decision_id, 'obstacle_update_id', p_obstacle_update_id),
        v_event_key
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
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
      'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در رفع مانع');
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_my_minutes_decision_obstacle(uuid, timestamptz, uuid, text) TO authenticated;

-- ── 5. get_my_minutes_decisions_summary() ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_minutes_decisions_summary()
RETURNS TABLE (
  total_count             integer,
  active_count            integer,
  completed_count         integer,
  stopped_count           integer,
  overdue_count           integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::integer                                                          AS total_count,
    COUNT(*) FILTER (WHERE status IN ('planned','in_progress','waiting_coordination','waiting_approval'))::integer AS active_count,
    COUNT(*) FILTER (WHERE status = 'completed')::integer                      AS completed_count,
    COUNT(*) FILTER (WHERE status = 'stopped')::integer                        AS stopped_count,
    COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < current_date
                     AND status NOT IN ('completed','stopped'))::integer       AS overdue_count
  FROM public.minutes_decisions
  WHERE primary_owner_user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_minutes_decisions_summary() TO authenticated;

-- ── 6. get_trackable_minutes_decisions_summary() ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_trackable_minutes_decisions_summary()
RETURNS TABLE (
  total_count              integer,
  active_count             integer,
  completed_count          integer,
  stopped_count            integer,
  overdue_count            integer,
  open_obstacle_count      integer,
  requires_followup_count  integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(DISTINCT d.id)::integer                                                          AS total_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.status IN ('planned','in_progress','waiting_coordination','waiting_approval'))::integer AS active_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'completed')::integer                   AS completed_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'stopped')::integer                     AS stopped_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.due_date IS NOT NULL AND d.due_date < current_date
                                AND d.status NOT IN ('completed','stopped'))::integer     AS overdue_count,
    COUNT(DISTINCT d.id) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.minutes_decision_updates u
      WHERE u.decision_id = d.id AND u.is_blocking = true AND u.resolved_at IS NULL
    ))::integer                                                                           AS open_obstacle_count,
    COUNT(DISTINCT d.id) FILTER (WHERE d.requires_followup = true
                                AND d.status NOT IN ('completed','stopped'))::integer     AS requires_followup_count
  FROM public.minutes_decisions d
  WHERE public._can_track_decisions(d.minute_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trackable_minutes_decisions_summary() TO authenticated;

-- ── 7. has_any_trackable_minutes_decision() ──────────────────────────────────
-- Determines if current user has any trackable decisions (for menu visibility)
CREATE OR REPLACE FUNCTION public.has_any_trackable_minutes_decision()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.minutes_decisions d
  WHERE public._can_track_decisions(d.minute_id)
  LIMIT 1;

  RETURN v_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_any_trackable_minutes_decision() TO authenticated;
