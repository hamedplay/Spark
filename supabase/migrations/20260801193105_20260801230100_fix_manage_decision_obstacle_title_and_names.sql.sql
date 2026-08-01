/*
# Fix manage_minutes_decision:
# 1. Validate obstacle_title is non-empty for obstacle operations (OBSTACLE_TITLE_REQUIRED)
# 2. Add obstacle_title and obstacle_severity to notification context
# 3. Fix name fallbacks to scalar subquery pattern (handles missing profile row)
*/

CREATE OR REPLACE FUNCTION public.manage_minutes_decision(
  p_decision_id uuid,
  p_expected_updated_at timestamptz,
  p_operation text,
  p_new_status text DEFAULT NULL::text,
  p_event_title text DEFAULT NULL::text,
  p_report_text text DEFAULT NULL::text,
  p_event_metadata jsonb DEFAULT '{}'::jsonb,
  p_obstacle_update_id uuid DEFAULT NULL::uuid,
  p_remind_at timestamptz DEFAULT NULL::timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  v_audience          text;
  v_seen              uuid[] := '{}'::uuid[];
  v_notif_event_type text;
  v_notif_title       text;
  v_notif_msg         text;
  v_event_key         text;
  v_msg_text          text;
  v_diag_sqlstate    text;
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

  -- Validate obstacle_title for obstacle operations
  IF p_operation = 'obstacle' THEN
    v_obstacle_title := NULLIF(btrim(COALESCE(p_event_title, '')), '');
    IF v_obstacle_title IS NULL THEN
      RAISE EXCEPTION 'OBSTACLE_TITLE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
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

  -- ── Reminder management ────────────────────────────────────────────────
  IF p_operation = 'followup' AND p_remind_at IS NOT NULL THEN
    IF p_remind_at <= now() THEN
      RAISE EXCEPTION 'REMIND_AT_MUST_BE_FUTURE' USING ERRCODE = 'P0001';
    END IF;

    v_recipient := v_decision.primary_owner_user_id;
    IF v_recipient IS NULL THEN
      RAISE EXCEPTION 'NO_REMINDER_RECIPIENT' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.minutes_decision_reminders
    SET status = 'cancelled', cancelled_at = now(), updated_at = now()
    WHERE decision_id = p_decision_id
    AND recipient_user_id = v_recipient
    AND status = 'pending';

    INSERT INTO public.minutes_decision_reminders (
      decision_id, minute_id, recipient_user_id,
      remind_at, status, created_by_user_id, source_update_id
    ) VALUES (
      p_decision_id, v_minute_id, v_recipient,
      p_remind_at, 'pending', v_user_id, v_update_id
    );
  END IF;

  IF p_operation = 'completion' THEN
    UPDATE public.minutes_decision_reminders
    SET status = 'cancelled', cancelled_at = now(), updated_at = now()
    WHERE decision_id = p_decision_id
    AND status = 'pending';
  END IF;

  IF p_operation = 'status_change' AND p_new_status = 'stopped' THEN
    UPDATE public.minutes_decision_reminders
    SET status = 'cancelled', cancelled_at = now(), updated_at = now()
    WHERE decision_id = p_decision_id
    AND status = 'pending';
  END IF;

  -- ── Resolve actor name via scalar subquery ────────────────────────────
  v_actor_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_user_id LIMIT 1),
    'کاربر'
  );

  -- ── Notifications with correct audience per recipient ──────────────────
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
    -- For status_change/followup/reopened: notify owner with audience=decision_owner
    IF p_operation IN ('status_change','followup','reopened') THEN
      IF v_decision.primary_owner_user_id IS NOT NULL
      AND v_decision.primary_owner_user_id IS DISTINCT FROM v_user_id THEN
        v_owner_name := COALESCE(
          (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_decision.primary_owner_user_id LIMIT 1),
          'مسئول مصوبه'
        );
        v_event_key := 'decision:' || p_decision_id::text || ':' || v_notif_event_type || ':' || v_update_id::text || ':' || v_decision.primary_owner_user_id::text;
        PERFORM public._create_minutes_notification(
          v_decision.primary_owner_user_id, v_notif_event_type, v_notif_title, v_notif_msg,
          'decision', p_decision_id, v_minute_id, v_revision, v_user_id,
          jsonb_build_object(
            'decision_id', p_decision_id,
            'operation', p_operation,
            'decision_title', v_decision.title,
            'decision_status', COALESCE(v_new_status, v_decision.status),
            'previous_decision_status', v_decision.status,
            'decision_link', '#minutes-my-decisions?decision=' || p_decision_id::text,
            'actor_name', v_actor_name,
            'audience', 'decision_owner'
          ),
          v_event_key
        );
      END IF;

    -- For obstacle/obstacle_resolved/completion: notify each recipient with correct audience
    ELSIF p_operation IN ('obstacle','obstacle_resolved','completion') THEN
      FOREACH v_recipient IN ARRAY ARRAY[
        v_decision.primary_owner_user_id, v_created_by, v_secretary_id, v_chair_id
      ] LOOP
        IF v_recipient IS NULL THEN CONTINUE; END IF;
        IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
        v_seen := array_append(v_seen, v_recipient);
        IF v_recipient IS DISTINCT FROM v_user_id THEN
          -- Determine audience based on recipient role
          v_audience := CASE
            WHEN v_recipient = v_decision.primary_owner_user_id THEN 'decision_owner'
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
              'operation', p_operation,
              'decision_title', v_decision.title,
              'decision_status', COALESCE(v_new_status, v_decision.status),
              'decision_progress', COALESCE(v_decision.progress_percent::text, ''),
              'obstacle_title', COALESCE(v_obstacle_title, COALESCE(p_event_title, '')),
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
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'operation', p_operation,
    'decision_id', p_decision_id,
    'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
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
