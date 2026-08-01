/*
# Fix resolve_my_minutes_decision_obstacle:
# Add actor name fallback via scalar subquery
*/

CREATE OR REPLACE FUNCTION public.resolve_my_minutes_decision_obstacle(
  p_decision_id uuid,
  p_expected_updated_at timestamptz,
  p_obstacle_update_id uuid,
  p_resolution_notes text DEFAULT NULL::text
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
  v_obstacle_exists  boolean;
  v_new_updated_at  timestamptz;
  v_update_id        uuid;
  v_recipient        uuid;
  v_audience         text;
  v_seen             uuid[] := '{}'::uuid[];
  v_event_key        text;
  v_msg_text         text;
  v_diag_sqlstate    text;
  v_actor_name       text;
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

  UPDATE public.minutes_decisions SET updated_at = now()
  WHERE id = p_decision_id
  RETURNING updated_at INTO v_new_updated_at;

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

  -- ── Resolve actor name ────────────────────────────────────────────────
  v_actor_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_user_id LIMIT 1),
    'کاربر'
  );

  -- Notify secretary, chair, creator with correct audience (owner is actor, excluded)
  FOREACH v_recipient IN ARRAY ARRAY[v_secretary_id, v_chair_id, v_created_by] LOOP
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

      v_event_key := 'decision:' || p_decision_id::text || ':decision_obstacle_resolved:' || v_update_id::text || ':' || v_recipient::text;
      PERFORM public._create_minutes_notification(
        v_recipient, 'decision_obstacle_resolved', 'مانع مصوبه رفع شد',
        'مانع رفع شد: ' || v_decision.title,
        'decision', p_decision_id, v_minute_id, v_revision, v_user_id,
        jsonb_build_object(
          'decision_id', p_decision_id,
          'obstacle_update_id', p_obstacle_update_id,
          'decision_title', v_decision.title,
          'decision_link', '#minutes-my-decisions?decision=' || p_decision_id::text,
          'actor_name', v_actor_name,
          'audience', v_audience
        ),
        v_event_key
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
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
        'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در رفع مانع');
END;
$$;
