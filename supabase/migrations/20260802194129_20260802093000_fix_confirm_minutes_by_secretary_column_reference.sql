/*
# Fix confirm_minutes_by_secretary: replace nonexistent minutes.title column

1. Purpose
   - The function `public.confirm_minutes_by_secretary` references a nonexistent
     column `minutes.title` in its SELECT INTO statement, causing SQLSTATE 42703
     (column does not exist) at runtime.
   - This migration redefines only that function, replacing `title` with
     `meeting_title_snapshot` in the SELECT column list.

2. Changes
   - CREATE OR REPLACE FUNCTION public.confirm_minutes_by_secretary
     with identical signature, SECURITY DEFINER, SET search_path = ''.
   - Only the SELECT column list changes: `title` → `meeting_title_snapshot`.
   - All permission checks, status validation, optimistic concurrency,
     notification logic, and response format remain unchanged.

3. Security
   - No RLS changes. No table structure changes. No data deletion.
   - SECURITY DEFINER and SET search_path = '' preserved.

4. Important notes
   - confirm_and_publish_minutes_by_chair is NOT modified; its column reference is correct.
   - No data is deleted, reset, or truncated.
*/

CREATE OR REPLACE FUNCTION public.confirm_minutes_by_secretary(
  p_minute_id uuid,
  p_expected_updated_at timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id           uuid;
  v_status            text;
  v_mode              text;
  v_existing_updated_at timestamptz;
  v_new_updated_at    timestamptz;
  v_msg_text          text;
  v_diag_sqlstate     text;
  v_chair_id          uuid;
  v_minute_title      text;
  v_revision          integer;
  v_context           jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, approval_mode, updated_at, chair_user_id, meeting_title_snapshot, revision_number
  INTO v_status, v_mode, v_existing_updated_at, v_chair_id, v_minute_title, v_revision
  FROM public.minutes
  WHERE id = p_minute_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_current_user_admin() AND
     NOT EXISTS (SELECT 1 FROM public.minutes
                WHERE id = p_minute_id AND secretary_user_id = v_user_id) THEN
    RAISE EXCEPTION 'MINUTES_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  IF v_mode = 'system' AND v_status <> 'approved' THEN
    RAISE EXCEPTION 'MINUTE_NOT_APPROVED' USING ERRCODE = 'P0001';
  END IF;
  IF v_mode = 'in_person' AND v_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'MINUTE_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_existing_updated_at THEN
    RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

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

  -- ── Notification: notify chair ──────────────────────────────────────────
  v_context := public._get_minute_notif_context(p_minute_id);
  IF v_chair_id IS NOT NULL AND v_chair_id IS DISTINCT FROM v_user_id THEN
    PERFORM public._create_minutes_notification(
      v_chair_id, 'minute_secretary_confirmed',
      'تأیید دبیر جلسه', 'دبیر جلسه صورت‌جلسه را تأیید کرد.',
      'minute', p_minute_id, p_minute_id, v_revision, v_user_id,
      v_context || jsonb_build_object('audience', 'chair'),
      'minute:' || p_minute_id::text || ':' || v_revision::text || ':minute_secretary_confirmed:' || v_chair_id::text
    );
  END IF;

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
$function$;
