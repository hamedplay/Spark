/*
# Fix submit_minutes_for_approval:
# 1. Fix name fallback to scalar subquery pattern
# 2. Add minute_revision_invalidated producer on resubmit
# 3. Use meeting_title_snapshot instead of title
*/

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
  v_approver_name     text;
  v_base_context      jsonb;
  v_old_approver_id   uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_approval_mode IS NULL OR p_approval_mode NOT IN ('system', 'in_person') THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_MODE' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, updated_at, approval_mode, revision_number, meeting_id, meeting_title_snapshot
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

    -- Emit minute_revision_invalidated to approvers of the previous revision
    v_base_context := public._get_minute_notif_context(p_minute_id);
    FOR v_old_approver_id IN
      SELECT DISTINCT approver_user_id FROM public.minutes_approvals
      WHERE minute_id = p_minute_id AND revision_number < v_revision AND status <> 'invalidated'
    LOOP
      IF v_old_approver_id IS DISTINCT FROM v_user_id THEN
        v_event_key := 'minute:' || p_minute_id::text || ':' || (v_revision - 1)::text || ':minute_revision_invalidated:' || v_old_approver_id::text;
        PERFORM public._create_minutes_notification(
          v_old_approver_id, 'minute_revision_invalidated',
          'باطل‌شدن بازبینی', 'بازبینی قبلی شما به‌دلیل ارسال مجدد صورت‌جلسه باطل شد.',
          'minute', p_minute_id, p_minute_id, v_revision - 1, v_user_id,
          v_base_context || jsonb_build_object(
            'audience', 'approvers',
            'minute_title', COALESCE(v_minute_title, ''),
            'minute_revision', (v_revision - 1)::text,
            'minute_link', '#minutes?minute=' || p_minute_id::text
          ),
          v_event_key
        );
      END IF;
    END LOOP;

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

  -- ── Notifications with approver_name ──────────────────────────────────
  v_base_context := public._get_minute_notif_context(p_minute_id);

  IF v_is_resubmit THEN
    FOR v_approver_user_id IN
      SELECT DISTINCT approver_user_id FROM public.minutes_approvals
      WHERE minute_id = p_minute_id AND revision_number = v_revision
    LOOP
      IF v_approver_user_id IS DISTINCT FROM v_user_id THEN
        v_approver_name := COALESCE(
          (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_approver_user_id LIMIT 1),
          'تأییدکننده'
        );

        v_event_key := 'minute:' || p_minute_id::text || ':' || v_revision::text || ':minute_resubmitted:' || v_approver_user_id::text;
        PERFORM public._create_minutes_notification(
          v_approver_user_id, 'minute_resubmitted',
          'ارسال مجدد صورت‌جلسه', 'صورت‌جلسه پس از اصلاح مجدداً ارسال شد.',
          'minute', p_minute_id, p_minute_id, v_revision, v_user_id,
          v_base_context || jsonb_build_object(
            'audience', 'approvers',
            'approver_name', v_approver_name,
            'full_name', v_approver_name,
            'recipient_greeting', v_approver_name,
            'minute_title', COALESCE(v_minute_title, ''),
            'minute_revision', v_revision::text,
            'approval_mode', p_approval_mode,
            'minute_link', '#minutes?minute=' || p_minute_id::text
          ),
          v_event_key
        );
      END IF;
    END LOOP;
  ELSE
    FOR v_approver_user_id IN
      SELECT DISTINCT approver_user_id FROM public.minutes_approvals
      WHERE minute_id = p_minute_id AND revision_number = v_revision
    LOOP
      IF v_approver_user_id IS DISTINCT FROM v_user_id THEN
        v_approver_name := COALESCE(
          (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_approver_user_id LIMIT 1),
          'تأییدکننده'
        );

        v_event_key := 'minute:' || p_minute_id::text || ':' || v_revision::text || ':minute_approval_requested:' || v_approver_user_id::text;
        PERFORM public._create_minutes_notification(
          v_approver_user_id, 'minute_approval_requested',
          'درخواست تأیید صورت‌جلسه', 'صورت‌جلسه در انتظار تأیید شماست.',
          'minute', p_minute_id, p_minute_id, v_revision, v_user_id,
          v_base_context || jsonb_build_object(
            'audience', 'approvers',
            'approver_name', v_approver_name,
            'full_name', v_approver_name,
            'recipient_greeting', v_approver_name,
            'minute_title', COALESCE(v_minute_title, ''),
            'minute_revision', v_revision::text,
            'approval_mode', p_approval_mode,
            'minute_link', '#minutes?minute=' || p_minute_id::text
          ),
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
