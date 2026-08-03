/*
# Fix manage_minutes_decision runtime errors
#
# 1. Remove cast to public.decision_status (column is text, not enum)
# 2. Use unaliased column names in SET clause (alias only in WHERE and RHS)
# 3. Restore publish gate: minute must be published + published_at not null
# 4. Fix minutes_decision_updates SET: no alias on target columns
# 5. Keep decision_followup event, decision_owner audience
# 6. Keep direct p_remind_at <= now() validation
# 7. Error handler logs full SQLSTATE/MESSAGE/DETAIL/HINT, returns generic message
#
# No previous migration edited. No data deleted.
*/

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
SET search_path = ''
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

  -- Lock the decision row
  SELECT * INTO v_decision
  FROM public.minutes_decisions d
  WHERE d.id = p_decision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_minute_id := v_decision.minute_id;

  -- Optimistic concurrency
  IF p_expected_updated_at IS NOT NULL AND v_decision.updated_at IS NOT NULL
     AND v_decision.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'DECISION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- Fetch minute metadata
  SELECT m.status, m.published_at, m.secretary_user_id, m.chair_user_id, m.created_by_user_id, m.revision_number
  INTO v_minute_status, v_minute_published_at, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes m
  WHERE m.id = v_minute_id;

  -- Publish gate: minute must be published with non-null published_at
  IF v_minute_status IS DISTINCT FROM 'published' OR v_minute_published_at IS NULL THEN
    RAISE EXCEPTION 'MINUTE_NOT_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;

  v_is_owner := (v_decision.primary_owner_user_id = v_user_id);

  -- Permission check
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

  -- Validate obstacle title
  IF p_operation = 'obstacle' AND (p_event_title IS NULL OR btrim(p_event_title) = '') THEN
    RAISE EXCEPTION 'OBSTACLE_TITLE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Reminder validation (direct comparison, no AT TIME ZONE)
  IF p_remind_at IS NOT NULL THEN
    IF p_remind_at <= now() THEN
      RAISE EXCEPTION 'REMINDER_MUST_BE_FUTURE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Determine event type
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
  v_new_completed_at := v_decision.completed_at;

  -- Status change logic
  IF p_operation = 'status_change' THEN
    IF p_new_status IS NULL THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_status NOT IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval','completed','stopped') THEN
      RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
    END IF;
    v_new_status := p_new_status;
    IF p_new_status = 'completed' THEN
      v_new_completed_at := now();
    ELSIF p_new_status <> 'completed' THEN
      v_new_completed_at := NULL;
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

  -- Prevent editing completed decisions (except reopen/obstacle_resolved)
  IF v_decision.status = 'completed' AND p_operation NOT IN ('reopened','obstacle_resolved') THEN
    RAISE EXCEPTION 'COMPLETED_DECISION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Validate obstacle_resolved
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

  -- Update the decision: unaliased SET targets, aliased WHERE
  v_new_updated_at := now();
  UPDATE public.minutes_decisions
  SET
    status = v_new_status,
    completed_at = v_new_completed_at,
    latest_update = COALESCE(p_report_text, latest_update),
    updated_at = v_new_updated_at
  WHERE id = p_decision_id;

  -- Insert update record: unaliased SET targets
  INSERT INTO public.minutes_decision_updates (
    decision_id, minute_id, previous_status, new_status,
    previous_progress_percent, new_progress_percent,
    update_text, event_type, event_title, event_metadata, is_blocking,
    created_by_user_id
  ) VALUES (
    p_decision_id, v_minute_id, v_decision.status, v_new_status,
    v_decision.progress_percent, v_decision.progress_percent,
    COALESCE(p_report_text, p_event_title, ''),
    v_event_type, p_event_title, p_event_metadata, v_is_blocking, v_user_id
  )
  RETURNING id INTO v_update_id;

  -- Resolve obstacle: unaliased SET
  IF p_operation = 'obstacle_resolved' THEN
    UPDATE public.minutes_decision_updates
    SET resolved_at = now(), resolved_by_user_id = v_user_id
    WHERE id = p_obstacle_update_id;
  END IF;

  -- Insert reminder
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

  -- Get actor name
  v_actor_name := COALESCE(
    (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles_public p WHERE p.user_id = v_user_id LIMIT 1),
    (SELECT NULLIF(btrim(p.username), '') FROM public.profiles_public p WHERE p.user_id = v_user_id LIMIT 1),
    'کاربر'
  );

  -- Notifications for status_change, followup, reopened
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

      v_notif_msg := v_actor_name || ' — ' || COALESCE(v_decision.title, 'مصوبه');

      v_event_key := 'decision:' || p_decision_id::text || ':' || v_event_type || ':' || v_update_id::text || ':' || v_decision.primary_owner_user_id::text;

      PERFORM public._create_minutes_notification(
        v_decision.primary_owner_user_id,
        v_notif_event_type,
        v_notif_title,
        v_notif_msg,
        'decision',
        p_decision_id,
        v_minute_id,
        v_revision,
        v_user_id,
        jsonb_build_object(
          'audience', 'decision_owner',
          'decision_title', COALESCE(v_decision.title, ''),
          'followup_method', COALESCE(p_event_metadata->>'method', ''),
          'followup_result', COALESCE(p_event_metadata->>'result', COALESCE(p_report_text, '')),
          'followup_date', COALESCE(p_event_metadata->>'next_followup_date', ''),
          'actor_name', v_actor_name,
          'decision_link', '#minutes-detail?minute=' || v_minute_id::text,
          'decision_owner_name', v_owner_name
        ),
        v_event_key
      );
    END IF;
  END IF;

  -- Notifications for obstacle, obstacle_resolved, completion
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

      v_event_key := 'decision:' || p_decision_id::text || ':' || v_event_type || ':' || v_update_id::text || ':' || v_recipient::text;

      PERFORM public._create_minutes_notification(
        v_recipient,
        v_notif_event_type,
        v_notif_title,
        v_notif_msg,
        'decision',
        p_decision_id,
        v_minute_id,
        v_revision,
        v_user_id,
        jsonb_build_object(
          'audience', v_audience,
          'decision_title', COALESCE(v_decision.title, ''),
          'actor_name', v_actor_name,
          'decision_link', '#minutes-detail?minute=' || v_minute_id::text
        ),
        v_event_key
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'updated_at', v_new_updated_at::text,
    'new_status', v_new_status,
    'update_id', v_update_id::text
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_diag_msg = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'success', false,
      'error_code', v_diag_msg,
      'message', v_diag_msg
    );
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_diag_sqlstate = RETURNED_SQLSTATE,
      v_diag_msg = MESSAGE_TEXT,
      v_diag_detail = PG_EXCEPTION_DETAIL,
      v_diag_hint = PG_EXCEPTION_HINT;
    RAISE LOG 'manage_minutes_decision internal error: sqlstate=%, msg=%, detail=%, hint=%',
      v_diag_sqlstate, v_diag_msg, v_diag_detail, v_diag_hint;
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INTERNAL_ERROR',
      'message', 'خطای داخلی در مدیریت مصوبه'
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) TO authenticated;
