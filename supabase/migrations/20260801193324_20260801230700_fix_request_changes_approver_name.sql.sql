/*
# Fix request_minutes_changes:
# Fix approver_name fallback to scalar subquery pattern
*/

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
  v_user_id           uuid;
  v_status            text;
  v_existing_updated_at timestamptz;
  v_new_updated_at    timestamptz;
  v_count             integer;
  v_first_reason      text;
  v_creator_id        uuid;
  v_secretary_id      uuid;
  v_minute_title      text;
  v_context           jsonb;
  v_recipient         uuid;
  v_seen              uuid[] := '{}'::uuid[];
  v_event_key         text;
  v_msg_text          text;
  v_diag_sqlstate     text;
  v_approver_name     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'PAYLOAD_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, updated_at, created_by_user_id, secretary_user_id, meeting_title_snapshot
  INTO v_status, v_existing_updated_at, v_creator_id, v_secretary_id, v_minute_title
  FROM public.minutes
  WHERE id = p_minute_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'MINUTE_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.minutes_approvals
    WHERE minute_id = p_minute_id AND revision_number = p_revision_number AND approver_user_id = v_user_id) THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_existing_updated_at THEN
    RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  v_count := jsonb_array_length(p_items);
  v_first_reason := p_items->0->>'reason';

  UPDATE public.minutes_approvals
  SET status = 'changes_requested', changes_requested_at = now(), updated_at = now()
  WHERE minute_id = p_minute_id
  AND revision_number = p_revision_number
  AND approver_user_id = v_user_id;

  UPDATE public.minutes SET
    status = 'changes_requested',
    updated_at = now()
  WHERE id = p_minute_id
  RETURNING updated_at INTO v_new_updated_at;

  -- ── Notification: minute_changes_requested to creator+secretary ─────────
  v_approver_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_user_id LIMIT 1),
    'تأییدکننده'
  );

  v_context := public._get_minute_notif_context(p_minute_id) ||
  jsonb_build_object(
    'change_reason', COALESCE(v_first_reason, ''),
    'approver_name', v_approver_name,
    'minute_title', COALESCE(v_minute_title, ''),
    'minute_revision', p_revision_number::text,
    'minute_link', '#minutes?minute=' || p_minute_id::text,
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
