/*
# Minutes Notifications — Phase 1: in-app notifications for Minutes workflow

## Purpose
Wire in-app notifications into the Minutes approval + decisions workflow.
Reuses the existing `public.notifications` table (no parallel table).
No email / SMS / push / cron — only in-app notifications created inside RPCs.

## Changes to `public.notifications`
Adds nullable metadata columns for Minutes/Decision linkage and idempotency:
- `entity_type text` — 'minutes' | 'decision'
- `entity_id uuid` — id of the minute or decision
- `minute_id uuid` — FK to minutes(id) ON DELETE CASCADE
- `revision_number int` — revision of the minute at event time
- `actor_user_id uuid` — who triggered the event (auth.uid() inside RPC)
- `metadata jsonb` — arbitrary structured payload
- `event_key text` — unique idempotency key, format:
    minutes:{minute_id}:{revision}:{event}:{recipient_user_id}
    decision:{decision_id}:{updated_at_epoch_ms}:{event}:{recipient_user_id}

Unique constraint `notifications_event_key_key` on (event_key) so retries
of the same RPC do not create duplicate notifications.

Indexes:
- `notifications_user_created_idx` on (user_id, created_at desc) — bell query
- `notifications_minute_idx` on (minute_id) — lookup by minute
- `notifications_unread_idx` on (user_id, read) where read = false — unread count

## Helper function `public._create_minutes_notification`
SECURITY DEFINER, search_path = '' (schema-qualified internally).
NOT EXECUTE for authenticated — only owner-role RPCs can call it.
Validates: recipient not null, event_type whitelisted, event_key unique.
Inserts one notification row with actor = auth.uid() (passed by caller RPC).
On duplicate event_key (unique_violation) it silently does nothing (idempotent).

## Wiring into existing RPCs (all SECURITY DEFINER, search_path='')
Each RPC now calls `_create_minutes_notification` for the relevant recipients
inside the same transaction, right before returning success:

- submit_minutes_for_approval (system mode):
    -> minutes_approval_requested to each approver of the new revision
- submit_minutes_for_approval (in_person mode):
    -> minutes_approval_requested to secretary (if secretary != actor)
- approve_minute_revision (all approved transition):
    -> minutes_all_approved to secretary
- request_minutes_changes:
    -> minutes_changes_requested to secretary, chair, and all approvers
       of the same revision (except the requester)
- confirm_minutes_by_secretary (system mode):
    -> minutes_secretary_confirmed to chair
- confirm_minutes_by_secretary (in_person mode):
    -> minutes_secretary_confirmed to chair
- confirm_and_publish_minutes_by_chair:
    -> minutes_published to: all present system participants, secretary,
       chair, and created_by_user_id (deduped, excluding the actor)
    -> decision_assigned to each distinct primary_owner_user_id of the
       minute's decisions (only when status transitions to published)
- update_decision_progress:
    Only when status transitions to completed / waiting_approval / stopped:
    -> decision_completed / decision_waiting_approval / decision_stopped
       to: secretary, chair, decision.created_by_user_id, and primary_owner
       (only if that recipient is not the actor)

## Security
- No new public INSERT path. The existing client INSERT policy remains for
  the general notification lib, but Minutes notifications are created only
  inside SECURITY DEFINER RPCs (bypass RLS) with actor = auth.uid().
- Recipients are derived from backend data (participants, secretary, chair,
  decision owners) — never from client parameters.
- `_create_minutes_notification` rejects NULL recipient and unknown event_type.
- Idempotency via unique `event_key`; duplicate retries are no-ops.
- RLS on `notifications` unchanged: users read/update/delete only their own
  rows; admins read all. No policy change needed.
*/

-- 1. Add metadata columns to notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS minute_id uuid REFERENCES public.minutes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS revision_number integer,
  ADD COLUMN IF NOT EXISTS actor_user_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS event_key text;

-- Unique idempotency key (NULLs allowed for legacy notifications)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_event_key_key'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX notifications_event_key_key ON public.notifications (event_key) WHERE event_key IS NOT NULL';
  END IF;
END $$;

-- Indexes for the bell + minute lookups
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_minute_idx
  ON public.notifications (minute_id);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (user_id, read)
  WHERE read = false;

-- 2. Helper function — SECURITY DEFINER, not executable by authenticated role
CREATE OR REPLACE FUNCTION public._create_minutes_notification(
  p_recipient_user_id uuid,
  p_event_type text,
  p_title text,
  p_message text,
  p_entity_type text,
  p_entity_id uuid,
  p_minute_id uuid,
  p_revision_number integer,
  p_actor_user_id uuid,
  p_metadata jsonb,
  p_event_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'NOTIF_RECIPIENT_NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_type IS NULL OR p_event_type NOT IN (
    'minutes_approval_requested',
    'minutes_all_approved',
    'minutes_changes_requested',
    'minutes_resubmitted',
    'minutes_secretary_confirmed',
    'minutes_published',
    'decision_assigned',
    'decision_completed',
    'decision_waiting_approval',
    'decision_stopped'
  ) THEN
    RAISE EXCEPTION 'NOTIF_EVENT_TYPE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.notifications (
      user_id, title, message, type, read,
      entity_type, entity_id, minute_id, revision_number,
      actor_user_id, metadata, event_key,
      created_at
    ) VALUES (
      p_recipient_user_id, p_title, p_message, 'meeting', false,
      p_entity_type, p_entity_id, p_minute_id, p_revision_number,
      p_actor_user_id, p_metadata, p_event_key,
      now()
    );
  EXCEPTION WHEN unique_violation THEN
    -- Idempotent: duplicate event_key means retry, do nothing
    NULL;
  END;
END;
$function$;

-- Revoke EXECUTE from authenticated/anon so only owner-role RPCs can call it
REVOKE EXECUTE ON FUNCTION public._create_minutes_notification(
  uuid, text, text, text, text, uuid, uuid, integer, uuid, jsonb, text
) FROM PUBLIC;

-- 3. Rewire submit_minutes_for_approval with notifications
CREATE OR REPLACE FUNCTION public.submit_minutes_for_approval(
  p_minute_id uuid,
  p_expected_updated_at timestamptz,
  p_approval_mode text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id           uuid;
  v_existing_status   text;
  v_existing_updated_at timestamptz;
  v_existing_mode     text;
  v_revision          integer;
  v_meeting_id        uuid;
  v_new_updated_at    timestamptz;
  v_meeting_title     text;
  v_secretary_id      uuid;
  v_chair_id          uuid;
  v_created_by        uuid;

  v_approver_user_id  uuid;
  v_approver_count    integer := 0;
  v_seen              uuid[] := '{}'::uuid[];
  v_is_resubmit       boolean := false;
  v_event_type        text;
  v_event_key         text;
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

  SELECT status, updated_at, approval_mode, revision_number, meeting_id,
         secretary_user_id, chair_user_id, created_by_user_id,
         meeting_title_snapshot
  INTO v_existing_status, v_existing_updated_at, v_existing_mode, v_revision,
       v_meeting_id, v_secretary_id, v_chair_id, v_created_by, v_meeting_title
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
    v_is_resubmit := true;
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

  -- Notifications (inside the same transaction)
  v_event_type := CASE WHEN v_is_resubmit THEN 'minutes_resubmitted' ELSE 'minutes_approval_requested' END;

  IF p_approval_mode = 'system' THEN
    FOREACH v_approver_user_id IN ARRAY v_seen LOOP
      IF v_approver_user_id IS DISTINCT FROM v_user_id THEN
        v_event_key := 'minutes:' || p_minute_id::text || ':' || v_revision || ':' || v_event_type || ':' || v_approver_user_id::text;
        PERFORM public._create_minutes_notification(
          v_approver_user_id,
          v_event_type,
          CASE WHEN v_is_resubmit THEN 'صورت‌جلسه برای تأیید مجدد ارسال شد' ELSE 'صورت‌جلسه برای تأیید ارسال شد' END,
          'صورت‌جلسه «' || COALESCE(v_meeting_title, 'بدون عنوان') || '» (نسخه ' || v_revision || ') برای تأیید شما ارسال شد.',
          'minutes', p_minute_id, p_minute_id, v_revision, v_user_id,
          jsonb_build_object('approval_mode', 'system'),
          v_event_key
        );
      END IF;
    END LOOP;
  ELSE
    -- in_person: notify secretary if not the actor
    IF v_secretary_id IS NOT NULL AND v_secretary_id IS DISTINCT FROM v_user_id THEN
      v_event_key := 'minutes:' || p_minute_id::text || ':' || v_revision || ':' || v_event_type || ':' || v_secretary_id::text;
      PERFORM public._create_minutes_notification(
        v_secretary_id,
        v_event_type,
        'صورت‌جلسه حضوری برای تأیید ارسال شد',
        'صورت‌جلسه «' || COALESCE(v_meeting_title, 'بدون عنوان') || '» (نسخه ' || v_revision || ') برای تأیید حضوری آماده است.',
        'minutes', p_minute_id, p_minute_id, v_revision, v_user_id,
        jsonb_build_object('approval_mode', 'in_person'),
        v_event_key
      );
    END IF;
  END IF;

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

-- 4. Rewire approve_minute_revision with notifications (all-approved -> secretary)
CREATE OR REPLACE FUNCTION public.approve_minute_revision(
  p_minute_id uuid,
  p_revision_number integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id          uuid;
  v_minute_status    text;
  v_minute_revision  integer;
  v_approval_mode    text;
  v_current_status   text;
  v_all_approved     boolean;
  v_secretary_id     uuid;
  v_meeting_title    text;
  v_event_key        text;
  v_msg_text         text;
  v_diag_sqlstate    text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

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

  SELECT bool_and(status = 'approved') INTO v_all_approved
  FROM public.minutes_approvals
  WHERE minute_id = p_minute_id
  AND revision_number = p_revision_number
  AND status <> 'invalidated';

  IF v_all_approved THEN
    UPDATE public.minutes SET status = 'approved' WHERE id = p_minute_id;

    SELECT secretary_user_id, meeting_title_snapshot
    INTO v_secretary_id, v_meeting_title
    FROM public.minutes WHERE id = p_minute_id;

    IF v_secretary_id IS NOT NULL AND v_secretary_id IS DISTINCT FROM v_user_id THEN
      v_event_key := 'minutes:' || p_minute_id::text || ':' || p_revision_number || ':minutes_all_approved:' || v_secretary_id::text;
      PERFORM public._create_minutes_notification(
        v_secretary_id,
        'minutes_all_approved',
        'همه تأییدکنندگان تأیید کردند',
        'صورت‌جلسه «' || COALESCE(v_meeting_title, 'بدون عنوان') || '» (نسخه ' || p_revision_number || ') توسط همه تأییدکنندگان تأیید شد. آماده تأیید نهایی دبیر.',
        'minutes', p_minute_id, p_minute_id, p_revision_number, v_user_id,
        jsonb_build_object('approval_mode', 'system'),
        v_event_key
      );
    END IF;

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
$function$;

-- 5. Rewire request_minutes_changes with notifications
CREATE OR REPLACE FUNCTION public.request_minutes_changes(
  p_minute_id uuid,
  p_revision_number integer,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
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
  v_secretary_id     uuid;
  v_chair_id         uuid;
  v_meeting_title    text;
  v_recipient        uuid;
  v_seen             uuid[] := '{}'::uuid[];
  v_event_key        text;
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

  SELECT status, revision_number, approval_mode, secretary_user_id, chair_user_id,
         meeting_title_snapshot
  INTO v_minute_status, v_minute_revision, v_approval_mode, v_secretary_id, v_chair_id,
       v_meeting_title
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

  -- Notifications: secretary, chair, and all approvers of this revision (except requester)
  FOREACH v_recipient IN ARRAY ARRAY[
    v_secretary_id, v_chair_id
  ] || COALESCE(ARRAY(
    SELECT DISTINCT approver_user_id FROM public.minutes_approvals
    WHERE minute_id = p_minute_id AND revision_number = p_revision_number
      AND approver_user_id IS DISTINCT FROM v_user_id
  ), ARRAY[]::uuid[])
  LOOP
    IF v_recipient IS NULL THEN CONTINUE; END IF;
    IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_recipient);

    v_event_key := 'minutes:' || p_minute_id::text || ':' || p_revision_number || ':minutes_changes_requested:' || v_recipient::text;
    PERFORM public._create_minutes_notification(
      v_recipient,
      'minutes_changes_requested',
      'درخواست اصلاح صورت‌جلسه',
      'صورت‌جلسه «' || COALESCE(v_meeting_title, 'بدون عنوان') || '» (نسخه ' || p_revision_number || ') نیاز به اصلاح دارد.',
      'minutes', p_minute_id, p_minute_id, p_revision_number, v_user_id,
      jsonb_build_object('items_count', v_count),
      v_event_key
    );
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
$function$;

-- 6. Rewire confirm_minutes_by_secretary with notifications (-> chair)
CREATE OR REPLACE FUNCTION public.confirm_minutes_by_secretary(
  p_minute_id uuid,
  p_expected_updated_at timestamptz
) RETURNS jsonb
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
  v_revision          integer;
  v_chair_id          uuid;
  v_meeting_title     text;
  v_event_key         text;
  v_msg_text          text;
  v_diag_sqlstate     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, approval_mode, updated_at, revision_number, chair_user_id,
         meeting_title_snapshot
  INTO v_status, v_mode, v_existing_updated_at, v_revision, v_chair_id,
       v_meeting_title
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

  -- Notify chair
  IF v_chair_id IS NOT NULL AND v_chair_id IS DISTINCT FROM v_user_id THEN
    v_event_key := 'minutes:' || p_minute_id::text || ':' || COALESCE(v_revision,0) || ':minutes_secretary_confirmed:' || v_chair_id::text;
    PERFORM public._create_minutes_notification(
      v_chair_id,
      'minutes_secretary_confirmed',
      'تأیید دبیر ثبت شد',
      'صورت‌جلسه «' || COALESCE(v_meeting_title, 'بدون عنوان') || '» توسط دبیر تأیید شد. آماده تأیید نهایی شما.',
      'minutes', p_minute_id, p_minute_id, v_revision, v_user_id,
      jsonb_build_object('approval_mode', v_mode),
      v_event_key
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

-- 7. Rewire confirm_and_publish_minutes_by_chair with notifications
CREATE OR REPLACE FUNCTION public.confirm_and_publish_minutes_by_chair(
  p_minute_id uuid,
  p_expected_updated_at timestamptz
) RETURNS jsonb
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
  v_revision          integer;
  v_all_approved      boolean;
  v_secretary_id      uuid;
  v_chair_id          uuid;
  v_created_by        uuid;
  v_meeting_title     text;
  v_recipient         uuid;
  v_seen              uuid[] := '{}'::uuid[];
  v_event_key         text;
  v_owner_id          uuid;
  v_msg_text          text;
  v_diag_sqlstate     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, approval_mode, updated_at, revision_number,
         secretary_user_id, chair_user_id, created_by_user_id,
         meeting_title_snapshot
  INTO v_status, v_mode, v_existing_updated_at, v_revision,
       v_secretary_id, v_chair_id, v_created_by, v_meeting_title
  FROM public.minutes
  WHERE id = p_minute_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_current_user_admin() AND
  NOT EXISTS (SELECT 1 FROM public.minutes
    WHERE id = p_minute_id AND chair_user_id = v_user_id) THEN
    RAISE EXCEPTION 'MINUTES_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.minutes
    WHERE id = p_minute_id AND secretary_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SECRETARY_NOT_CONFIRMED' USING ERRCODE = 'P0001';
  END IF;

  IF v_mode = 'system' THEN
    SELECT bool_and(status = 'approved') INTO v_all_approved
    FROM public.minutes_approvals
    WHERE minute_id = p_minute_id
    AND revision_number = v_revision
    AND status <> 'invalidated';

    IF NOT v_all_approved THEN
      RAISE EXCEPTION 'NOT_ALL_APPROVERS_APPROVED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_existing_updated_at THEN
    RAISE EXCEPTION 'MINUTES_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

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

  -- minutes_published to: present system participants, secretary, chair, created_by (dedup, excl actor)
  FOREACH v_recipient IN ARRAY ARRAY[v_secretary_id, v_chair_id, v_created_by]
    || COALESCE(ARRAY(
      SELECT DISTINCT mp.user_id FROM public.minutes_participants mp
      WHERE mp.minute_id = p_minute_id
        AND mp.user_id IS NOT NULL
        AND mp.attendance_status IN ('present', 'online', 'late', 'delegate_attended')
    ), ARRAY[]::uuid[])
  LOOP
    IF v_recipient IS NULL THEN CONTINUE; END IF;
    IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_recipient);

    IF v_recipient IS DISTINCT FROM v_user_id THEN
      v_event_key := 'minutes:' || p_minute_id::text || ':' || COALESCE(v_revision,0) || ':minutes_published:' || v_recipient::text;
      PERFORM public._create_minutes_notification(
        v_recipient,
        'minutes_published',
        'صورت‌جلسه منتشر شد',
        'صورت‌جلسه «' || COALESCE(v_meeting_title, 'بدون عنوان') || '» منتشر شد.',
        'minutes', p_minute_id, p_minute_id, v_revision, v_user_id,
        jsonb_build_object('approval_mode', v_mode),
        v_event_key
      );
    END IF;
  END LOOP;

  -- decision_assigned to each distinct primary_owner_user_id
  FOR v_owner_id IN
    SELECT DISTINCT d.primary_owner_user_id
    FROM public.minutes_decisions d
    WHERE d.minute_id = p_minute_id
      AND d.primary_owner_user_id IS NOT NULL
  LOOP
    v_event_key := 'minutes:' || p_minute_id::text || ':' || COALESCE(v_revision,0) || ':decision_assigned:' || v_owner_id::text;
    PERFORM public._create_minutes_notification(
      v_owner_id,
      'decision_assigned',
      'مصوبه جدید به شما محول شد',
      'یک مصوبه از صورت‌جلسه «' || COALESCE(v_meeting_title, 'بدون عنوان') || '» به شما محول شد.',
      'decision', NULL, p_minute_id, v_revision, v_user_id,
      jsonb_build_object('minute_id', p_minute_id),
      v_event_key
    );
  END LOOP;

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
$function$;

-- 8. Rewire update_decision_progress with notifications
CREATE OR REPLACE FUNCTION public.update_decision_progress(
  p_decision_id uuid,
  p_status text,
  p_progress_percent integer,
  p_update_text text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id           uuid;
  v_decision          public.minutes_decisions%ROWTYPE;
  v_minute_status     text;
  v_minute_id         uuid;
  v_secretary_id      uuid;
  v_chair_id          uuid;
  v_created_by        uuid;
  v_revision          integer;

  v_new_status        text;
  v_new_progress      integer;
  v_new_completed_at timestamptz;
  v_new_updated_at   timestamptz;

  v_is_meaningful_change boolean;
  v_is_notifiable    boolean := false;
  v_event_type       text;
  v_recipient        uuid;
  v_seen             uuid[] := '{}'::uuid[];
  v_event_key        text;
  v_msg_text         text;
  v_diag_sqlstate    text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval','completed','stopped') THEN
    RAISE EXCEPTION 'INVALID_DECISION_STATUS' USING ERRCODE = 'P0001';
  END IF;

  IF p_progress_percent IS NULL OR p_progress_percent < 0 OR p_progress_percent > 100 THEN
    RAISE EXCEPTION 'INVALID_PROGRESS_PERCENT' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_decision
  FROM public.minutes_decisions
  WHERE id = p_decision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECISION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, id, secretary_user_id, chair_user_id, created_by_user_id, revision_number
  INTO v_minute_status, v_minute_id, v_secretary_id, v_chair_id, v_created_by, v_revision
  FROM public.minutes
  WHERE id = v_decision.minute_id
  FOR UPDATE;

  IF v_minute_status NOT IN ('published', 'approved') THEN
    RAISE EXCEPTION 'MINUTE_NOT_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    public.is_current_user_admin()
    OR v_decision.primary_owner_user_id IS NOT DISTINCT FROM v_user_id
    OR v_secretary_id IS NOT DISTINCT FROM v_user_id
    OR v_chair_id IS NOT DISTINCT FROM v_user_id
  ) THEN
    RAISE EXCEPTION 'DECISION_NO_PERMISSION' USING ERRCODE = 'P0001';
  END IF;

  v_new_status   := p_status;
  v_new_progress := p_progress_percent;

  IF v_new_progress = 100 AND v_new_status <> 'completed' THEN
    v_new_status := 'completed';
  END IF;

  IF v_new_status = 'completed' AND v_new_progress <> 100 THEN
    RAISE EXCEPTION 'COMPLETION_REQUIRES_FULL_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  IF v_new_status = 'completed' THEN
    v_new_completed_at := now();
  ELSE
    v_new_completed_at := NULL;
  END IF;

  IF v_decision.status = v_new_status
  AND v_decision.progress_percent = v_new_progress
  AND COALESCE(v_decision.latest_update, '') = COALESCE(p_update_text, '') THEN
    v_is_meaningful_change := false;
  ELSE
    v_is_meaningful_change := true;
  END IF;

  -- Notifiable only on transition into completed / waiting_approval / stopped
  IF v_decision.status IS DISTINCT FROM v_new_status
     AND v_new_status IN ('completed', 'waiting_approval', 'stopped') THEN
    v_is_notifiable := true;
    v_event_type := CASE v_new_status
      WHEN 'completed' THEN 'decision_completed'
      WHEN 'waiting_approval' THEN 'decision_waiting_approval'
      WHEN 'stopped' THEN 'decision_stopped'
    END;
  END IF;

  UPDATE public.minutes_decisions SET
    status           = v_new_status,
    progress_percent = v_new_progress,
    completed_at     = v_new_completed_at,
    latest_update    = p_update_text
  WHERE id = p_decision_id
  RETURNING updated_at INTO v_new_updated_at;

  IF v_is_meaningful_change THEN
    INSERT INTO public.minutes_decision_updates (
      decision_id, minute_id,
      previous_status, new_status,
      previous_progress_percent, new_progress_percent,
      update_text, created_by_user_id
    ) VALUES (
      p_decision_id, v_decision.minute_id,
      v_decision.status, v_new_status,
      v_decision.progress_percent, v_new_progress,
      p_update_text, v_user_id
    );
  END IF;

  IF v_is_notifiable THEN
    FOREACH v_recipient IN ARRAY ARRAY[
      v_secretary_id, v_chair_id, v_created_by, v_decision.primary_owner_user_id
    ] LOOP
      IF v_recipient IS NULL THEN CONTINUE; END IF;
      IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
      v_seen := array_append(v_seen, v_recipient);

      IF v_recipient IS DISTINCT FROM v_user_id THEN
        v_event_key := 'decision:' || p_decision_id::text || ':' ||
          to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS') || ':' ||
          v_event_type || ':' || v_recipient::text;
        PERFORM public._create_minutes_notification(
          v_recipient,
          v_event_type,
          CASE v_event_type
            WHEN 'decision_completed' THEN 'مصوبه تکمیل شد'
            WHEN 'decision_waiting_approval' THEN 'مصوبه در انتظار تأیید'
            WHEN 'decision_stopped' THEN 'مصوبه متوقف شد'
          END,
          'وضعیت مصوبه تغییر یافت: ' || v_new_status,
          'decision', p_decision_id, v_minute_id, v_revision, v_user_id,
          jsonb_build_object('decision_id', p_decision_id, 'new_status', v_new_status),
          v_event_key
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'decision_id', p_decision_id,
    'status', v_new_status,
    'progress_percent', v_new_progress,
    'completed_at', v_new_completed_at,
    'updated_at', to_char(v_new_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'history_written', v_is_meaningful_change
  );

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
      'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در به‌روزرسانی پیشرفت مصوبه');
END;
$function$;
