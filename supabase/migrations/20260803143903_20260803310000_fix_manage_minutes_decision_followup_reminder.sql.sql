/*
# Fix followup reminder logic in manage_minutes_decision:
# 1. Compute remind_at from metadata next_followup_date (Gregorian YYYY-MM-DD)
#    + next_followup_time (HH:mm) at Asia/Tehran timezone, not browser timezone.
# 2. Cancel previous pending reminder (set status='cancelled', cancelled_at, updated_at)
#    instead of always inserting a new one (which violates the unique index).
# 3. Only insert a new pending reminder if a next followup date is provided.
# 4. Validate date/time format precisely; reject past times with REMINDER_MUST_BE_FUTURE.
# 5. Fall back to p_remind_at only when metadata has no date (legacy caller compat).
# 6. All operations (history, cancel old reminder, insert new reminder) stay atomic.
# 7. Row is already FOR UPDATE, so concurrent calls serialize on the decision row.
# 8. Do NOT drop or weaken uniq_pending_reminder_per_decision_recipient.
# Signature unchanged. No data deleted. No previous migration edited.
*/

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
  -- Followup reminder variables
  v_meta_date        text;
  v_meta_time        text;
  v_effective_remind_at timestamptz;
  v_parsed_date      date;
  v_parsed_time      text;
  v_old_reminder_id  uuid;
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

  -- ── Compute effective remind_at from metadata or legacy p_remind_at ──────
  IF p_operation = 'followup' THEN
    v_meta_date := p_event_metadata->>'next_followup_date';
    v_meta_time := p_event_metadata->>'next_followup_time';

    IF v_meta_date IS NOT NULL AND v_meta_date <> '' THEN
      -- Validate date format: must be YYYY-MM-DD and parseable
      BEGIN
        v_parsed_date := v_meta_date::date;
      EXCEPTION WHEN invalid_datetime_format THEN
        RAISE EXCEPTION 'INVALID_REMINDER_DATE_TIME' USING ERRCODE = 'P0001';
      END;

      -- Validate time format: must be HH:mm
      IF v_meta_time IS NULL OR v_meta_time = '' OR v_meta_time !~ '^\d{2}:[0-5]\d$' THEN
        RAISE EXCEPTION 'INVALID_REMINDER_DATE_TIME' USING ERRCODE = 'P0001';
      END IF;

      -- Combine date + time and interpret as Asia/Tehran wall clock
      BEGIN
        v_effective_remind_at := (v_parsed_date::text || ' ' || v_meta_time || ':00')::timestamp AT TIME ZONE 'Asia/Tehran';
      EXCEPTION WHEN invalid_datetime_format THEN
        RAISE EXCEPTION 'INVALID_REMINDER_DATE_TIME' USING ERRCODE = 'P0001';
      END;

      -- Must be in the future
      IF v_effective_remind_at <= now() THEN
        RAISE EXCEPTION 'REMINDER_MUST_BE_FUTURE' USING ERRCODE = 'P0001';
      END IF;
    ELSIF p_remind_at IS NOT NULL THEN
      -- Legacy caller: p_remind_at provided directly
      v_effective_remind_at := p_remind_at;
      IF v_effective_remind_at <= now() THEN
        RAISE EXCEPTION 'REMINDER_MUST_BE_FUTURE' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  ELSIF p_remind_at IS NOT NULL THEN
    IF p_remind_at <= now() THEN
      RAISE EXCEPTION 'REMINDER_MUST_BE_FUTURE' USING ERRCODE = 'P0001';
    END IF;
    v_effective_remind_at := p_remind_at;
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

  -- ── Reminder management: cancel old pending, insert new if date provided ──
  IF p_operation = 'followup' THEN
    v_recipient := v_decision.primary_owner_user_id;
    IF v_recipient IS NULL THEN
      RAISE EXCEPTION 'NO_REMINDER_RECIPIENT' USING ERRCODE = 'P0001';
    END IF;

    -- Find and cancel previous pending reminder for this decision + recipient
    SELECT id INTO v_old_reminder_id
    FROM public.minutes_decision_reminders
    WHERE decision_id = p_decision_id
      AND recipient_user_id = v_recipient
      AND status = 'pending'
    FOR UPDATE;

    IF v_old_reminder_id IS NOT NULL THEN
      UPDATE public.minutes_decision_reminders
      SET status = 'cancelled',
          cancelled_at = now(),
          updated_at = now()
      WHERE id = v_old_reminder_id;
    END IF;

    -- Insert new pending reminder only if a next followup date was provided
    IF v_effective_remind_at IS NOT NULL THEN
      INSERT INTO public.minutes_decision_reminders (
        decision_id, minute_id, recipient_user_id,
        remind_at, status, created_by_user_id, source_update_id
      ) VALUES (
        p_decision_id, v_minute_id, v_recipient,
        v_effective_remind_at, 'pending', v_user_id, v_update_id
      );
    END IF;
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
          'decision_status', v_new_status, 'previous_decision_status', v_decision.status,
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
