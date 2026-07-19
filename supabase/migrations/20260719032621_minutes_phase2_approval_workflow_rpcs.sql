-- ============================================================
-- Migration: Minutes Phase 2 — Approval Workflow RPCs
--
-- Creates 5 SECURITY INVOKER RPCs:
--   1. public.submit_minutes_for_approval(uuid, timestamptz, text)
--   2. public.approve_minute_revision(uuid, integer)
--   3. public.request_minutes_changes(uuid, integer, jsonb)
--   4. public.confirm_minutes_by_secretary(uuid, timestamptz)
--   5. public.confirm_and_publish_minutes_by_chair(uuid, timestamptz)
--
-- All: SET search_path = '', schema-qualified, transactional,
--      internal authorization, no user_id from client for sensitive fields.
-- ============================================================

-- ============================================================
-- Helper: can_manage_minutes_submission
-- Returns true if current user can submit/resubmit a minute
-- (admin, created_by, or secretary).
-- SECURITY DEFINER to bypass RLS on minutes read for the check.
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_manage_minutes_submission(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.minutes m
    WHERE m.id = p_minute_id
    AND (
      public.is_current_user_admin()
      OR m.created_by_user_id = auth.uid()
      OR m.secretary_user_id = auth.uid()
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_minutes_submission(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_manage_minutes_submission(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_manage_minutes_submission(uuid) TO authenticated;


-- ============================================================
-- RPC 1: submit_minutes_for_approval
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_minutes_for_approval(
  p_minute_id           uuid,
  p_expected_updated_at timestamptz,
  p_approval_mode       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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

  -- Approver selection
  v_approver_user_id  uuid;
  v_approver_count    integer := 0;
  v_seen              uuid[] := '{}'::uuid[];

  -- Diagnostics
  v_constraint_name   text;
  v_msg_text         text;
  v_diag_sqlstate    text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_approval_mode IS NULL OR p_approval_mode NOT IN ('system', 'in_person') THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_MODE' USING ERRCODE = 'P0001';
  END IF;

  -- Lock and load existing minute
  SELECT status, updated_at, approval_mode, revision_number, meeting_id
    INTO v_existing_status, v_existing_updated_at, v_existing_mode, v_revision, v_meeting_id
    FROM public.minutes
   WHERE id = p_minute_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Authorization: admin, created_by, or secretary
  IF NOT public.can_manage_minutes_submission(p_minute_id) THEN
    RAISE EXCEPTION 'MINUTES_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  -- Status must be draft or changes_requested
  IF v_existing_status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'MINUTE_NOT_SUBMITTABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Optimistic concurrency
  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_existing_updated_at THEN
    RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- approval_mode immutability after first submit
  IF v_existing_mode IS NOT NULL AND v_existing_mode IS DISTINCT FROM p_approval_mode THEN
    RAISE EXCEPTION 'APPROVAL_MODE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Determine new revision number
  IF v_existing_status = 'changes_requested' THEN
    v_revision := v_revision + 1;
    -- Invalidate prior revision approvals (pending or approved)
    UPDATE public.minutes_approvals
       SET status = 'invalidated', updated_at = now()
     WHERE minute_id = p_minute_id
       AND revision_number < v_revision
       AND status IN ('pending', 'approved');
  ELSE
    v_revision := COALESCE(v_revision, 1);
  END IF;

  -- For system mode, select approvers from present internal participants
  IF p_approval_mode = 'system' THEN
    FOR v_approver_user_id IN
      SELECT DISTINCT mp.user_id
        FROM public.minutes_participants mp
       WHERE mp.minute_id = p_minute_id
         AND mp.user_id IS NOT NULL
         AND mp.attendance_status IN ('present', 'online', 'late', 'delegate_attended')
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

  -- Update minute: status, approval_mode, revision, submit info, reset confirmations
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

  RETURN jsonb_build_object(
    'success', true,
    'minute_id', p_minute_id,
    'status', 'pending_approval',
    'approval_mode', p_approval_mode,
    'revision_number', v_revision,
    'approver_count', v_approver_count,
    'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
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

REVOKE ALL ON FUNCTION public.submit_minutes_for_approval(uuid, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_minutes_for_approval(uuid, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_minutes_for_approval(uuid, timestamptz, text) TO authenticated;


-- ============================================================
-- RPC 2: approve_minute_revision
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_minute_revision(
  p_minute_id       uuid,
  p_revision_number integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
  v_diag_sqlstate     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Lock minute row
  SELECT status, revision_number, approval_mode
    INTO v_minute_status, v_minute_revision, v_approval_mode
    FROM public.minutes
   WHERE id = p_minute_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Only system mode supports participant approvals
  IF v_approval_mode IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_SYSTEM_MODE' USING ERRCODE = 'P0001';
  END IF;

  IF v_minute_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'MINUTE_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  IF p_revision_number <> v_minute_revision THEN
    RAISE EXCEPTION 'REVISION_NOT_CURRENT' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the caller's approval row
  SELECT status INTO v_current_status
    FROM public.minutes_approvals
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent: already approved
  IF v_current_status = 'approved' THEN
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', 'already_approved', 'message', 'تأیید شما قبلاً ثبت شده است');
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  -- Mark approved
  UPDATE public.minutes_approvals
     SET status = 'approved', approved_at = now(), updated_at = now()
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id = v_user_id;

  -- Check if all current-revision approvals are approved
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

REVOKE ALL ON FUNCTION public.approve_minute_revision(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_minute_revision(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_minute_revision(uuid, integer) TO authenticated;


-- ============================================================
-- RPC 3: request_minutes_changes
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_minutes_changes(
  p_minute_id       uuid,
  p_revision_number integer,
  p_items           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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

  -- Lock minute
  SELECT status, revision_number, approval_mode
    INTO v_minute_status, v_minute_revision, v_approval_mode
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

  -- Lock caller's approval
  SELECT id, status INTO v_approval_id, v_current_status
    FROM public.minutes_approvals
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent: already changes_requested
  IF v_current_status = 'changes_requested' THEN
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', 'already_requested', 'message', 'درخواست اصلاح شما قبلاً ثبت شده است');
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  -- Validate each item
  v_items_arr := p_items;
  FOR v_i IN 0..jsonb_array_length(v_items_arr) - 1 LOOP
    v_item := v_items_arr->v_i;

    v_reason := v_item->>'reason';
    IF v_reason IS NULL OR btrim(v_reason) = '' THEN
      RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
    END IF;

    v_agenda_id := NULLIF(v_item->>'agenda_result_id', '')::uuid;

    -- If agenda_result_id provided, must belong to this minute
    IF v_agenda_id IS NOT NULL AND
       NOT EXISTS (SELECT 1 FROM public.minutes_agenda_results
                    WHERE id = v_agenda_id AND minute_id = p_minute_id) THEN
      RAISE EXCEPTION 'AGENDA_RESULT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    -- General objection (agenda NULL) requires non-empty suggested_correction
    v_suggested := v_item->>'suggested_correction';
    IF v_agenda_id IS NULL AND (v_suggested IS NULL OR btrim(v_suggested) = '') THEN
      RAISE EXCEPTION 'GENERAL_OBJECTION_NEEDS_CORRECTION' USING ERRCODE = 'P0001';
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- Mark this approval as changes_requested
  UPDATE public.minutes_approvals
     SET status = 'changes_requested', changes_requested_at = now(), updated_at = now()
   WHERE id = v_approval_id;

  -- Insert comments
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

  -- Invalidate other pending/approved approvals of this revision
  UPDATE public.minutes_approvals
     SET status = 'invalidated', updated_at = now()
   WHERE minute_id = p_minute_id
     AND revision_number = p_revision_number
     AND approver_user_id <> v_user_id
     AND status IN ('pending', 'approved');

  -- Set minute status to changes_requested
  UPDATE public.minutes SET status = 'changes_requested' WHERE id = p_minute_id;

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

REVOKE ALL ON FUNCTION public.request_minutes_changes(uuid, integer, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_minutes_changes(uuid, integer, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_minutes_changes(uuid, integer, jsonb) TO authenticated;


-- ============================================================
-- RPC 4: confirm_minutes_by_secretary
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_minutes_by_secretary(
  p_minute_id           uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id           uuid;
  v_status            text;
  v_mode              text;
  v_existing_updated_at timestamptz;
  v_new_updated_at    timestamptz;
  v_msg_text          text;
  v_diag_sqlstate     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, approval_mode, updated_at
    INTO v_status, v_mode, v_existing_updated_at
    FROM public.minutes
   WHERE id = p_minute_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Authorization: secretary or admin
  IF NOT public.is_current_user_admin() AND
     NOT EXISTS (SELECT 1 FROM public.minutes
                 WHERE id = p_minute_id AND secretary_user_id = v_user_id) THEN
    RAISE EXCEPTION 'MINUTES_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  -- In system mode, minute must be 'approved' (all participants approved)
  -- In in_person mode, minute must be 'pending_approval'
  IF v_mode = 'system' AND v_status <> 'approved' THEN
    RAISE EXCEPTION 'MINUTE_NOT_APPROVED' USING ERRCODE = 'P0001';
  END IF;
  IF v_mode = 'in_person' AND v_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'MINUTE_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  -- Optimistic concurrency
  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_existing_updated_at THEN
    RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent: already confirmed by secretary
  IF EXISTS (SELECT 1 FROM public.minutes
             WHERE id = p_minute_id AND secretary_confirmed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', v_status, 'message', 'تأیید دبیر قبلاً ثبت شده است');
  END IF;

  UPDATE public.minutes SET
    secretary_confirmed_at = now(),
    secretary_confirmed_by_user_id = v_user_id
   WHERE id = p_minute_id
   RETURNING updated_at INTO v_new_updated_at;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
    'status', v_status,
    'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'message', 'تأیید دبیر ثبت شد. در انتظار تأیید نهایی رئیس جلسه.');

  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
      RETURN jsonb_build_object('success', false, 'error_code', v_msg_text,
        'sqlstate', 'P0001', 'message', v_msg_text);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
        'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در تأیید دبیر');
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_minutes_by_secretary(uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_minutes_by_secretary(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_minutes_by_secretary(uuid, timestamptz) TO authenticated;


-- ============================================================
-- RPC 5: confirm_and_publish_minutes_by_chair
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_and_publish_minutes_by_chair(
  p_minute_id           uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id           uuid;
  v_status            text;
  v_mode              text;
  v_existing_updated_at timestamptz;
  v_new_updated_at    timestamptz;
  v_all_approved      boolean;
  v_msg_text          text;
  v_diag_sqlstate     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, approval_mode, updated_at
    INTO v_status, v_mode, v_existing_updated_at
    FROM public.minutes
   WHERE id = p_minute_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Authorization: chair or admin
  IF NOT public.is_current_user_admin() AND
     NOT EXISTS (SELECT 1 FROM public.minutes
                 WHERE id = p_minute_id AND chair_user_id = v_user_id) THEN
    RAISE EXCEPTION 'MINUTES_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  -- Secretary must have confirmed
  IF NOT EXISTS (SELECT 1 FROM public.minutes
                 WHERE id = p_minute_id AND secretary_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SECRETARY_NOT_CONFIRMED' USING ERRCODE = 'P0001';
  END IF;

  -- In system mode, all current-revision approvals must be 'approved'
  IF v_mode = 'system' THEN
    SELECT bool_and(status = 'approved') INTO v_all_approved
      FROM public.minutes_approvals
     WHERE minute_id = p_minute_id
       AND revision_number = (SELECT revision_number FROM public.minutes WHERE id = p_minute_id)
       AND status <> 'invalidated';

    IF NOT v_all_approved THEN
      RAISE EXCEPTION 'NOT_ALL_APPROVERS_APPROVED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Optimistic concurrency
  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_existing_updated_at THEN
    RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent: already published
  IF v_status = 'published' THEN
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', 'published', 'message', 'صورت‌جلسه قبلاً منتشر شده است');
  END IF;

  UPDATE public.minutes SET
    status = 'published',
    chair_confirmed_at = now(),
    chair_confirmed_by_user_id = v_user_id,
    published_at = now(),
    published_by_user_id = v_user_id
   WHERE id = p_minute_id
   RETURNING updated_at INTO v_new_updated_at;

  RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
    'status', 'published',
    'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'message', 'صورت‌جلسه منتشر شد.');

  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
      RETURN jsonb_build_object('success', false, 'error_code', v_msg_text,
        'sqlstate', 'P0001', 'message', v_msg_text);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
      RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
        'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در انتشار صورت‌جلسه');
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_and_publish_minutes_by_chair(uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_and_publish_minutes_by_chair(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_and_publish_minutes_by_chair(uuid, timestamptz) TO authenticated;
