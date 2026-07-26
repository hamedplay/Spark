/*
# Remove attendance filter from submit_minutes_for_approval

## Summary
In the "system" approval mode, the RPC `submit_minutes_for_approval` previously
created `minutes_approvals` rows only for internal participants whose
`attendance_status` was one of `present`, `online`, `late`, or
`delegate_attended`. This meant a participant's presence at the meeting was a
condition for being added to the approver list.

This change removes that attendance filter. Now, in system mode, an approval
row is created for **every** internal participant that has a valid `user_id`,
regardless of attendance status. This keeps the approval workflow intact
(participant approvals → secretary confirmation → chair confirmation &
publish) while making the approver set independent of attendance.

## Changes
1. `public.submit_minutes_for_approval` — the `SELECT DISTINCT mp.user_id`
   loop no longer filters by `mp.attendance_status`. All internal
   participants with a non-null `user_id` become approvers.
2. Duplicate handling is preserved via the existing
   `ON CONFLICT (minute_id, revision_number, approver_user_id) DO UPDATE`
   clause, so re-submissions / new revisions do not create duplicate rows.
3. The `NO_ELIGIBLE_APPROVERS` error is still raised when there are zero
   internal participants with a valid `user_id` (i.e. no one to approve).
4. In-person mode is unchanged: no `minutes_approvals` rows are created.
5. The approval_mode immutability check is unchanged.

## Security
- No RLS policy changes.
- The function remains `SECURITY DEFINER` with the same permission checks
  (`can_manage_minutes_submission`).
- No new tables or columns.

## Notes
- The secretary and chair, if they are also internal participants, are
  included in the approver set rather than being silently dropped. They are
  not removed based on a documented decision.
- This migration is safe to re-run (it only redefines the function).
*/

CREATE OR REPLACE FUNCTION public.submit_minutes_for_approval(
  p_minute_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_approval_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_approval_mode IS NULL OR p_approval_mode NOT IN ('system', 'in_person') THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_MODE' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, updated_at, approval_mode, revision_number, meeting_id
    INTO v_existing_status, v_existing_updated_at, v_existing_mode, v_revision, v_meeting_id
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
$function$;
