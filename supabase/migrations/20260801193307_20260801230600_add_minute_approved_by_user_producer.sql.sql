/*
# Fix approve_minute_revision:
# Add minute_approved_by_user producer (notify creator and secretary)
*/

CREATE OR REPLACE FUNCTION public.approve_minute_revision(
  p_minute_id uuid,
  p_revision_number integer
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
  v_current_status   text;
  v_all_approved     boolean;
  v_msg_text         text;
  v_diag_sqlstate    text;
  v_secretary_id     uuid;
  v_creator_id       uuid;
  v_minute_title     text;
  v_context          jsonb;
  v_recipient        uuid;
  v_audience         text;
  v_seen             uuid[] := '{}'::uuid[];
  v_event_key        text;
  v_approver_name    text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, revision_number, approval_mode, secretary_user_id, created_by_user_id, meeting_title_snapshot
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

  SELECT status INTO v_current_status
    FROM public.minutes_approvals
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  IF v_current_status = 'approved' THEN
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', 'already_approved', 'message', 'تأیید شما قبلاً ثبت شده است');
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.minutes_approvals
     SET status = 'approved', approved_at = now(), updated_at = now()
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id = v_user_id;

  PERFORM public._write_minutes_audit(
    p_minute_id, 'approval_given', 'approval', v_user_id, p_revision_number,
    NULL, jsonb_build_object('revision', p_revision_number), NULL
  );

  -- ── Emit minute_approved_by_user to creator and secretary ─────────────
  v_approver_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_user_id LIMIT 1),
    'تأییدکننده'
  );

  v_context := public._get_minute_notif_context(p_minute_id);

  FOREACH v_recipient IN ARRAY ARRAY[v_creator_id, v_secretary_id] LOOP
    IF v_recipient IS NULL THEN CONTINUE; END IF;
    IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_recipient);
    IF v_recipient IS DISTINCT FROM v_user_id THEN
      v_audience := CASE WHEN v_recipient = v_secretary_id THEN 'secretary' ELSE 'creator' END;
      v_event_key := 'minute:' || p_minute_id::text || ':' || p_revision_number::text || ':minute_approved_by_user:' || v_recipient::text;
      PERFORM public._create_minutes_notification(
        v_recipient, 'minute_approved_by_user',
        'تأیید صورت‌جلسه', 'یک تأییدکننده صورت‌جلسه را تأیید کرد: ' || COALESCE(v_minute_title, ''),
        'minute', p_minute_id, p_minute_id, p_revision_number, v_user_id,
        v_context || jsonb_build_object(
          'audience', v_audience,
          'approver_name', v_approver_name,
          'minute_title', COALESCE(v_minute_title, ''),
          'minute_revision', p_revision_number::text,
          'minute_link', '#minutes?minute=' || p_minute_id::text
        ),
        v_event_key
      );
    END IF;
  END LOOP;

  SELECT bool_and(status = 'approved') INTO v_all_approved
    FROM public.minutes_approvals
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND status <> 'invalidated';

  IF v_all_approved THEN
    UPDATE public.minutes SET status = 'approved' WHERE id = p_minute_id;
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', 'approved', 'message', 'همه تأییدکنندگان تأیید کردند. صورت‌جلسه تأیید شد.');
  END IF;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
    'status', 'pending_approval', 'message', 'تأیید شما ثبت شد. در انتظار تأیید سایر تأییدکنندگان.');

  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
      RETURN jsonb_build_object('success', false, 'error_code', v_msg_text,
        'sqlstate', 'P0001', 'message', v_msg_text);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
        'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در تأیید صورت‌جلسه');
END;
$$;
