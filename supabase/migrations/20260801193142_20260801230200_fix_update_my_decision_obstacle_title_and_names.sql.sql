/*
# Fix update_my_minutes_decision:
# 1. Validate obstacle_title for obstacle events (OBSTACLE_TITLE_REQUIRED)
# 2. Add obstacle_title and obstacle_severity to context
# 3. Fix actor name fallback to scalar subquery pattern
*/

CREATE OR REPLACE FUNCTION public.update_my_minutes_decision(
  p_decision_id uuid,
  p_expected_updated_at timestamptz,
  p_progress_percent integer DEFAULT NULL::integer,
  p_status text DEFAULT NULL::text,
  p_report_text text DEFAULT NULL::text,
  p_event_type text DEFAULT 'progress'::text,
  p_event_title text DEFAULT NULL::text,
  p_event_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  -- Validate obstacle_title for obstacle events
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

  -- ── Resolve actor name via scalar subquery ────────────────────────────
  v_actor_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_user_id LIMIT 1),
    'کاربر'
  );

  -- ── Notifications with correct audience ────────────────────────────────
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
    -- Recipients: creator, secretary, chair (owner is the actor, excluded)
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
            'decision_id', p_decision_id,
            'event_type', v_event_type,
            'decision_title', v_decision.title,
            'decision_status', COALESCE(v_new_status, v_decision.status),
            'previous_decision_status', v_decision.status,
            'decision_progress', COALESCE(v_new_progress::text, ''),
            'obstacle_title', COALESCE(v_obstacle_title, COALESCE(v_event_title, '')),
            'obstacle_severity', CASE WHEN v_is_blocking THEN 'blocking' ELSE 'minor' END,
            'decision_link', '#minutes-my-decisions?decision=' || p_decision_id::text,
            'actor_name', v_actor_name,
            'audience', v_audience
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
    'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),
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
