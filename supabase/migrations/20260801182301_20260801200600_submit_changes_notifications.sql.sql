/*
# Add notifications to request_minutes_changes and submit_minutes_for_approval

request_minutes_changes: notify creator+secretary (minute_changes_requested)
submit_minutes_for_approval: notify each approver (minute_approval_requested or minute_resubmitted)
*/

-- ── request_minutes_changes ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.request_minutes_changes(
  p_minute_id uuid,
  p_revision_number integer,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id          uuid;
  v_minute_status    text;
  v_minute_revision  integer;
  v_approval_mode    text;
  v_approval_id      uuid;
  v_current_status   text;
  v_items_arr        jsonb;
  v_item             jsonb;
  v_i                int;
  v_agenda_id        uuid;
  v_reason           text;
  v_suggested        text;
  v_count            int := 0;
  v_msg_text         text;
  v_diag_sqlstate    text;
  v_secretary_id     uuid;
  v_creator_id       uuid;
  v_minute_title     text;
  v_context          jsonb;
  v_recipient         uuid;
  v_seen             uuid[] := '{}'::uuid[];
  v_first_reason     text;
  v_event_key        text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'NO_CHANGE_ITEMS' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, revision_number, approval_mode, secretary_user_id, created_by_user_id, title
    INTO v_minute_status, v_minute_revision, v_approval_mode, v_secretary_id, v_creator_id, v_minute_title
    FROM public.minutes
   WHERE id = p_minute_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_approval_mode IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_SYSTEM_MODE' USING ERRCODE = 'P0001';
  END IF;

  IF v_minute_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'MINUTE_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  IF p_revision_number <> v_minute_revision THEN
    RAISE EXCEPTION 'REVISION_NOT_CURRENT' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, status INTO v_approval_id, v_current_status
    FROM public.minutes_approvals
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  IF v_current_status = 'changes_requested' THEN
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', 'already_requested', 'message', 'درخواست اصلاح شما قبلاً ثبت شده است');
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  v_items_arr := p_items;
  FOR v_i IN 0..jsonb_array_length(v_items_arr) - 1 LOOP
    v_item := v_items_arr->v_i;

    v_reason := v_item->>'reason';
    IF v_reason IS NULL OR btrim(v_reason) = '' THEN
      RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
    END IF;

    v_agenda_id := NULLIF(v_item->>'agenda_result_id', '')::uuid;

    IF v_agenda_id IS NOT NULL AND
       NOT EXISTS (SELECT 1 FROM public.minutes_agenda_results
                    WHERE id = v_agenda_id AND minute_id = p_minute_id) THEN
      RAISE EXCEPTION 'AGENDA_RESULT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    v_suggested := v_item->>'suggested_correction';
    IF v_agenda_id IS NULL AND (v_suggested IS NULL OR btrim(v_suggested) = '') THEN
      RAISE EXCEPTION 'GENERAL_OBJECTION_NEEDS_CORRECTION' USING ERRCODE = 'P0001';
    END IF;

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.minutes_approvals
     SET status = 'changes_requested', changes_requested_at = now(), updated_at = now()
   WHERE id = v_approval_id;

  FOR v_i IN 0..jsonb_array_length(v_items_arr) - 1 LOOP
    v_item := v_items_arr->v_i;
    v_agenda_id := NULLIF(v_item->>'agenda_result_id', '')::uuid;
    v_reason := v_item->>'reason';
    v_suggested := v_item->>'suggested_correction';

    INSERT INTO public.minutes_approval_comments
      (approval_id, minute_id, revision_number, agenda_result_id,
       reason, suggested_correction, created_by_user_id)
      VALUES (v_approval_id, p_minute_id, p_revision_number, v_agenda_id,
              v_reason, v_suggested, v_user_id);
  END LOOP;

  UPDATE public.minutes_approvals
     SET status = 'invalidated', updated_at = now()
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id <> v_user_id
     AND status IN ('pending', 'approved');

  UPDATE public.minutes SET status = 'changes_requested' WHERE id = p_minute_id;

  -- ── Notification: minute_changes_requested to creator+secretary ─────────
  v_first_reason := p_items->0->>'reason';
  v_context := public._get_minute_notif_context(p_minute_id) ||
    jsonb_build_object(
      'change_reason', COALESCE(v_first_reason, ''),
      'approver_name', '',
      'audience', 'creator'
    );

  FOREACH v_recipient IN ARRAY ARRAY[v_creator_id, v_secretary_id] LOOP
    IF v_recipient IS NULL THEN CONTINUE; END IF;
    IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_recipient);
    IF v_recipient IS DISTINCT FROM v_user_id THEN
      v_event_key := 'minute:' || p_minute_id::text || ':' || p_revision_number::text || ':minute_changes_requested:' || v_recipient::text;
      PERFORM public._create_minutes_notification(
        v_recipient, 'minute_changes_requested',
        'درخواست اصلاح صورت‌جلسه', 'برای صورت‌جلسه اصلاح درخواست شد: ' || COALESCE(v_first_reason, ''),
        'minute', p_minute_id, p_minute_id, p_revision_number, v_user_id,
        v_context || jsonb_build_object('audience', 'creator'),
        v_event_key
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
    'status', 'changes_requested', 'items_count', v_count,
    'message', 'درخواست اصلاح ثبت شد. صورت‌جلسه برای اصلاح به دبیر بازگردانده شد.');

  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
      RETURN jsonb_build_object('success', false, 'error_code', v_msg_text,
        'sqlstate', 'P0001', 'message', v_msg_text);
    WHEN invalid_text_representation OR numeric_value_out_of_range OR datatype_mismatch THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object('success', false, 'error_code', 'PAYLOAD_INVALID',
        'sqlstate', v_diag_sqlstate, 'message', 'ساختار اطلاعات ارسالی معتبر نیست');
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
        'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در درخواست اصلاح');
END;
$$;

-- ── submit_minutes_for_approval ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_minutes_for_approval(
  p_minute_id uuid,
  p_expected_updated_at timestamptz,
  p_approval_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id           uuid;
  v_existing_status   text;
  v_existing_updated_at timestamptz;
  v_existing_mode     text;
  v_revision          integer;
  v_meeting_id        uuid;
  v_new_updated_at    timestamptz;
  v_approver_user_id  uuid;
  v_approver_count    integer := 0;
  v_seen              uuid[] := '{}'::uuid[];
  v_constraint_name   text;
  v_msg_text          text;
  v_diag_sqlstate     text;
  v_is_resubmit       boolean := false;
  v_context           jsonb;
  v_event_key         text;
  v_minute_title      text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_approval_mode IS NULL OR p_approval_mode NOT IN ('system', 'in_person') THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_MODE' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, updated_at, approval_mode, revision_number, meeting_id, title
  INTO v_existing_status, v_existing_updated_at, v_existing_mode, v_revision, v_meeting_id, v_minute_title
  FROM public.minutes
  WHERE id = p_minute_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.can_manage_minutes_submission(p_minute_id) THEN
    RAISE EXCEPTION 'MINUTES_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  IF v_existing_status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'MINUTE_NOT_SUBMITTABLE' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_existing_updated_at THEN
    RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  IF v_existing_mode IS NOT NULL AND v_existing_mode IS DISTINCT FROM p_approval_mode THEN
    RAISE EXCEPTION 'APPROVAL_MODE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  v_is_resubmit := (v_existing_status = 'changes_requested');

  IF v_existing_status = 'changes_requested' THEN
    v_revision := v_revision + 1;
    UPDATE public.minutes_approvals
    SET status = 'invalidated', updated_at = now()
    WHERE minute_id = p_minute_id
    AND revision_number < v_revision
    AND status IN ('pending', 'approved');
  ELSE
    v_revision := COALESCE(v_revision, 1);
  END IF;

  IF p_approval_mode = 'system' THEN
    FOR v_approver_user_id IN
    SELECT DISTINCT mp.user_id
    FROM public.minutes_participants mp
    WHERE mp.minute_id = p_minute_id
    AND mp.user_id IS NOT NULL
    ORDER BY mp.user_id
    LOOP
      IF v_approver_user_id = ANY(v_seen) THEN
        CONTINUE;
      END IF;
      v_seen := array_append(v_seen, v_approver_user_id);

      INSERT INTO public.minutes_approvals
      (minute_id, revision_number, approver_user_id, status)
      VALUES (p_minute_id, v_revision, v_approver_user_id, 'pending')
      ON CONFLICT (minute_id, revision_number, approver_user_id)
      DO UPDATE SET status = 'pending',
      approved_at = NULL,
      changes_requested_at = NULL,
      updated_at = now();
      v_approver_count := v_approver_count + 1;
    END LOOP;

    IF v_approver_count = 0 THEN
      RAISE EXCEPTION 'NO_ELIGIBLE_APPROVERS' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.minutes SET
  status = 'pending_approval',
  approval_mode = p_approval_mode,
  revision_number = v_revision,
  submitted_at = now(),
  submitted_by_user_id = v_user_id,
  secretary_confirmed_at = NULL,
  secretary_confirmed_by_user_id = NULL,
  chair_confirmed_at = NULL,
  chair_confirmed_by_user_id = NULL
  WHERE id = p_minute_id
  RETURNING updated_at INTO v_new_updated_at;

  -- ── Notifications ──────────────────────────────────────────────────────
  v_context := public._get_minute_notif_context(p_minute_id);

  IF v_is_resubmit THEN
    -- minute_resubmitted to approvers
    FOR v_approver_user_id IN
      SELECT DISTINCT approver_user_id FROM public.minutes_approvals
      WHERE minute_id = p_minute_id AND revision_number = v_revision
    LOOP
      IF v_approver_user_id IS DISTINCT FROM v_user_id THEN
        v_event_key := 'minute:' || p_minute_id::text || ':' || v_revision::text || ':minute_resubmitted:' || v_approver_user_id::text;
        PERFORM public._create_minutes_notification(
          v_approver_user_id, 'minute_resubmitted',
          'ارسال مجدد صورت‌جلسه', 'صورت‌جلسه پس از اصلاح مجدداً ارسال شد.',
          'minute', p_minute_id, p_minute_id, v_revision, v_user_id,
          v_context || jsonb_build_object('audience', 'approvers'),
          v_event_key
        );
      END IF;
    END LOOP;
  ELSE
    -- minute_approval_requested to each approver
    FOR v_approver_user_id IN
      SELECT DISTINCT approver_user_id FROM public.minutes_approvals
      WHERE minute_id = p_minute_id AND revision_number = v_revision
    LOOP
      IF v_approver_user_id IS DISTINCT FROM v_user_id THEN
        v_event_key := 'minute:' || p_minute_id::text || ':' || v_revision::text || ':minute_approval_requested:' || v_approver_user_id::text;
        PERFORM public._create_minutes_notification(
          v_approver_user_id, 'minute_approval_requested',
          'درخواست تأیید صورت‌جلسه', 'صورت‌جلسه در انتظار تأیید شماست.',
          'minute', p_minute_id, p_minute_id, v_revision, v_user_id,
          v_context || jsonb_build_object('audience', 'approvers'),
          v_event_key
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
  'success', true,
  'minute_id', p_minute_id,
  'status', 'pending_approval',
  'approval_mode', p_approval_mode,
  'revision_number', v_revision,
  'approver_count', v_approver_count,
  'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
  );

  EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
  RETURN jsonb_build_object('success', false, 'error_code', v_msg_text,
  'sqlstate', 'P0001', 'message', v_msg_text);
  WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
  RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
  'sqlstate', '23505', 'message', 'خطای داخلی در ارسال برای تأیید');
  WHEN invalid_text_representation OR numeric_value_out_of_range OR datatype_mismatch THEN
  GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
  RETURN jsonb_build_object('success', false, 'error_code', 'PAYLOAD_INVALID',
  'sqlstate', v_diag_sqlstate, 'message', 'ساختار اطلاعات ارسالی معتبر نیست');
  WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
  RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
  'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در ارسال برای تأیید');
END;
$$;
