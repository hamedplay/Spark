/*
# Minutes Approval Delegate — Independent Delegate Selection for Minute Approval

## Summary

This migration adds an independent delegate (جانشین) model for minutes approval,
separate from meeting invitation delegation. An approver can assign a delegate who
can then approve or request changes on their behalf. The original approver remains
the responsible party; the delegate is tracked separately.

## 1. New Columns on `public.minutes_approvals`

- `delegate_user_id` (uuid, nullable) — the delegated approver
- `delegated_by_user_id` (uuid, nullable) — the original approver who assigned the delegate
- `delegated_at` (timestamptz, nullable) — when delegation was set
- `acted_by_user_id` (uuid, nullable) — who actually performed the approve/changes_requested action

Foreign keys reference `auth.users(id)` with `ON DELETE SET NULL` — deleting a user
does NOT cascade-delete or remove the approval row; only nullifies the reference.

`approver_user_id` remains unchanged — it always holds the original approver.

## 2. New RPC: `assign_minutes_approval_delegate`

SECURITY DEFINER, SET search_path = ''. Only `authenticated` can EXECUTE
(PUBLIC and anon are revoked). The caller must be the `approver_user_id` of the
approval row. Validates:
- approval belongs to current revision
- minute status is `pending_approval`
- approval status is `pending`
- delegate is not self
- delegate has a valid, active, non-hidden profile in the same organization
- no delegation chains (delegate cannot re-delegate)
- delegate is not already an approver of the same minute+revision
- optimistic concurrency via `p_expected_updated_at`

All delegate-assignment and notification creation happen in the same transaction.

## 3. Modified RPCs: `approve_minute_revision` and `request_minutes_changes`

Both now allow action by either `approver_user_id` OR `delegate_user_id`.
`acted_by_user_id` is set to `auth.uid()` on action. After approved/changes_requested,
delegation is locked (cannot be changed).

## 4. New Notification Event Types

- `minute_approval_delegate_assigned` — category: minutes, audience: approvers (sent to delegate)
- `minute_approver_delegate_selected` — category: minutes, audience: creator/secretary/chair/approvers/all

## 5. Notification Templates

Upserted with `ON CONFLICT DO NOTHING` to avoid overwriting manual edits.

## 6. RLS

The existing SELECT policy on `minutes_approvals` is extended to also allow
users who are `delegate_user_id` to read their delegated approvals.

## Important Notes

1. No existing migration is edited.
2. No data is deleted, reset, truncated, or cascaded.
3. `approver_user_id` is never changed by delegation.
4. The `meeting/change` event is never fired for delegate operations.
5. Deduplication is handled via unique idempotency keys in notification_outbox.
*/

-- ── 1. Add delegate columns to minutes_approvals ──────────────────────────────

ALTER TABLE public.minutes_approvals
  ADD COLUMN IF NOT EXISTS delegate_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delegated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delegated_at timestamptz,
  ADD COLUMN IF NOT EXISTS acted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 2. Extend SELECT policy to include delegates ──────────────────────────────

DROP POLICY IF EXISTS "minutes_approvals_select" ON public.minutes_approvals;
CREATE POLICY "minutes_approvals_select"
ON public.minutes_approvals FOR SELECT
TO authenticated
USING (
  is_current_user_admin()
  OR approver_user_id = auth.uid()
  OR delegate_user_id = auth.uid()
  OR (
    EXISTS (
      SELECT 1 FROM minutes m
      WHERE m.id = minutes_approvals.minute_id
      AND (
        m.created_by_user_id = auth.uid()
        OR m.secretary_user_id = auth.uid()
        OR m.chair_user_id = auth.uid()
      )
    )
  )
);

-- ── 3. New event registry entries ─────────────────────────────────────────────

INSERT INTO public.notification_event_registry
  (event_key, category, entity_type, label_fa, notification_enabled, sms_supported, group_rule_supported, allowed_audiences, required_placeholders, optional_placeholders, is_active)
VALUES
  (
    'minute_approval_delegate_assigned',
    'minutes',
    'minute',
    'انتخاب به‌عنوان جانشین تأییدکننده',
    true,
    true,
    true,
    ARRAY['approvers', 'all'],
    ARRAY['minute_title', 'original_approver_name'],
    ARRAY['minute_revision', 'delegate_name', 'minute_link', 'recipient_greeting', 'full_name'],
    true
  ),
  (
    'minute_approver_delegate_selected',
    'minutes',
    'minute',
    'انتخاب جانشین تأییدکننده',
    true,
    false,
    true,
    ARRAY['creator', 'secretary', 'chair', 'approvers', 'all'],
    ARRAY['minute_title', 'original_approver_name', 'delegate_name'],
    ARRAY['minute_revision', 'actor_name', 'minute_link', 'recipient_greeting', 'full_name'],
    true
  )
ON CONFLICT (event_key) DO NOTHING;

-- ── 4. Notification templates (upsert, no overwrite) ──────────────────────────

-- Template for delegate (the person assigned as delegate)
INSERT INTO public.notification_templates
  (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES
  (
    'minutes',
    'minute_approval_delegate_assigned',
    'approvers',
    'انتخاب به‌عنوان جانشین تأییدکننده',
    '{{recipient_greeting}}، شما به‌عنوان جانشین {{original_approver_name}} برای بررسی و تأیید صورت‌جلسه «{{minute_title}}» نسخه {{minute_revision}} انتخاب شده‌اید.',
    'user-check',
    'blue',
    ARRAY['minute_title', 'minute_revision', 'original_approver_name', 'delegate_name', 'recipient_greeting', 'full_name', 'minute_link'],
    true
  )
ON CONFLICT DO NOTHING;

-- Template for other stakeholders (secretary, chair, creator, other approvers)
INSERT INTO public.notification_templates
  (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES
  (
    'minutes',
    'minute_approver_delegate_selected',
    'all',
    'انتخاب جانشین تأییدکننده',
    '{{original_approver_name}}، {{delegate_name}} را به‌عنوان جانشین خود برای تأیید صورت‌جلسه «{{minute_title}}» نسخه {{minute_revision}} انتخاب کرد.',
    'users',
    'blue',
    ARRAY['minute_title', 'minute_revision', 'original_approver_name', 'delegate_name', 'actor_name', 'recipient_greeting', 'full_name', 'minute_link'],
    true
  )
ON CONFLICT DO NOTHING;

-- SMS template for delegate assignment (sms_supported = true)
INSERT INTO public.sms_templates
  (category, event_type, audience, subject, body, placeholders, is_active)
VALUES
  (
    'minutes',
    'minute_approval_delegate_assigned',
    'approvers',
    'انتخاب به‌عنوان جانشین تأییدکننده',
    '{{recipient_greeting}}، شما به‌عنوان جانشین {{original_approver_name}} برای بررسی و تأیید صورت‌جلسه «{{minute_title}}» نسخه {{minute_revision}} انتخاب شده‌اید.',
    ARRAY['minute_title', 'minute_revision', 'original_approver_name', 'delegate_name', 'recipient_greeting', 'full_name'],
    true
  )
ON CONFLICT DO NOTHING;

-- ── 5. assign_minutes_approval_delegate RPC ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_minutes_approval_delegate(
  p_approval_id uuid,
  p_delegate_user_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id              uuid;
  v_approval             public.minutes_approvals%ROWTYPE;
  v_minute_status        text;
  v_minute_revision      integer;
  v_minute_title         text;
  v_secretary_id         uuid;
  v_creator_id           uuid;
  v_chair_id             uuid;
  v_approver_org         text;
  v_delegate_org         text;
  v_delegate_name        text;
  v_approver_name        text;
  v_context              jsonb;
  v_recipient            uuid;
  v_seen                 uuid[] := '{}'::uuid[];
  v_event_key            text;
  v_msg_text             text;
  v_diag_sqlstate        text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the approval row
  SELECT * INTO v_approval
  FROM public.minutes_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Only the original approver can assign a delegate
  IF v_approval.approver_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  -- Cannot self-delegate
  IF p_delegate_user_id = v_user_id THEN
    RAISE EXCEPTION 'CANNOT_DELEGATE_TO_SELF' USING ERRCODE = 'P0001';
  END IF;

  -- Delegation chain check: if this approval already has a delegate, reject
  IF v_approval.delegate_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'DELEGATE_ALREADY_ASSIGNED' USING ERRCODE = 'P0001';
  END IF;

  -- Approval must be pending
  IF v_approval.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  -- Fetch parent minute
  SELECT status, revision_number, meeting_title_snapshot, secretary_user_id, created_by_user_id, chair_user_id
  INTO v_minute_status, v_minute_revision, v_minute_title, v_secretary_id, v_creator_id, v_chair_id
  FROM public.minutes
  WHERE id = v_approval.minute_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Minute must be pending_approval
  IF v_minute_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'MINUTE_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  -- Approval must belong to current revision
  IF v_approval.revision_number <> v_minute_revision THEN
    RAISE EXCEPTION 'REVISION_NOT_CURRENT' USING ERRCODE = 'P0001';
  END IF;

  -- Optimistic concurrency check
  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_approval.updated_at THEN
    RAISE EXCEPTION 'APPROVAL_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- Delegate must not already be an approver of the same minute+revision
  IF EXISTS (
    SELECT 1 FROM public.minutes_approvals
    WHERE minute_id = v_approval.minute_id
    AND revision_number = v_approval.revision_number
    AND approver_user_id = p_delegate_user_id
  ) THEN
    RAISE EXCEPTION 'DELEGATE_ALREADY_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  -- Validate delegate profile: must exist, be active, non-hidden, same org
  SELECT organization INTO v_delegate_org
  FROM public.profiles
  WHERE user_id = p_delegate_user_id
  AND is_active = true
  AND COALESCE(is_hidden, false) = false
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELEGATE_PROFILE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- Get approver's org
  SELECT organization INTO v_approver_org
  FROM public.profiles
  WHERE user_id = v_user_id
  LIMIT 1;

  -- Same organization check (both must have matching non-null org, or both null)
  IF COALESCE(v_approver_org, '') <> COALESCE(v_delegate_org, '') THEN
    RAISE EXCEPTION 'DELEGATE_DIFFERENT_ORG' USING ERRCODE = 'P0001';
  END IF;

  -- Get names for notifications
  v_approver_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_user_id LIMIT 1),
    'تأییدکننده'
  );
  v_delegate_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = p_delegate_user_id LIMIT 1),
    'جانشین'
  );

  -- Update the approval with delegate info
  UPDATE public.minutes_approvals
  SET delegate_user_id = p_delegate_user_id,
      delegated_by_user_id = v_user_id,
      delegated_at = now(),
      updated_at = now()
  WHERE id = p_approval_id;

  -- Audit
  PERFORM public._write_minutes_audit(
    v_approval.minute_id, 'delegate_assigned', 'approval', v_user_id, v_minute_revision,
    NULL,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'delegate_user_id', p_delegate_user_id,
      'delegate_name', v_delegate_name
    ),
    NULL
  );

  -- Build notification context
  v_context := public._get_minute_notif_context(v_approval.minute_id) || jsonb_build_object(
    'minute_title', COALESCE(v_minute_title, ''),
    'minute_revision', v_minute_revision::text,
    'original_approver_name', v_approver_name,
    'delegate_name', v_delegate_name,
    'actor_name', v_approver_name,
    'minute_link', '#minutes?minute=' || v_approval.minute_id::text
  );

  -- ── Notification 1: to delegate (minute_approval_delegate_assigned) ──────
  v_event_key := 'minute:' || v_approval.minute_id::text || ':' || v_minute_revision::text
    || ':delegate_assigned:' || p_approval_id::text
    || ':approver:' || v_user_id::text
    || ':delegate:' || p_delegate_user_id::text;

  PERFORM public._create_minutes_notification(
    p_delegate_user_id,
    'minute_approval_delegate_assigned',
    'انتخاب به‌عنوان جانشین تأییدکننده',
    v_approver_name || ' شما را به‌عنوان جانشین خود برای تأیید صورت‌جلسه «' || COALESCE(v_minute_title, '') || '» انتخاب کرد.',
    'minute', v_approval.minute_id, v_approval.minute_id, v_minute_revision, v_user_id,
    v_context || jsonb_build_object('audience', 'approvers'),
    v_event_key
  );

  -- ── Notification 2: to other stakeholders (minute_approver_delegate_selected) ──
  -- Recipients: secretary, chair, creator, and other approvers of current revision
  -- Exclude: original approver and delegate themselves
  v_seen := ARRAY[v_user_id, p_delegate_user_id];

  -- Secretary
  IF v_secretary_id IS NOT NULL AND NOT (v_secretary_id = ANY(v_seen)) THEN
    v_seen := array_append(v_seen, v_secretary_id);
    v_event_key := 'minute:' || v_approval.minute_id::text || ':' || v_minute_revision::text
      || ':delegate_selected:' || p_approval_id::text
      || ':role:secretary:' || v_secretary_id::text;
    PERFORM public._create_minutes_notification(
      v_secretary_id,
      'minute_approver_delegate_selected',
      'انتخاب جانشین تأییدکننده',
      v_approver_name || '، ' || v_delegate_name || ' را به‌عنوان جانشین خود برای تأیید صورت‌جلسه انتخاب کرد.',
      'minute', v_approval.minute_id, v_approval.minute_id, v_minute_revision, v_user_id,
      v_context || jsonb_build_object('audience', 'secretary'),
      v_event_key
    );
  END IF;

  -- Chair
  IF v_chair_id IS NOT NULL AND NOT (v_chair_id = ANY(v_seen)) THEN
    v_seen := array_append(v_seen, v_chair_id);
    v_event_key := 'minute:' || v_approval.minute_id::text || ':' || v_minute_revision::text
      || ':delegate_selected:' || p_approval_id::text
      || ':role:chair:' || v_chair_id::text;
    PERFORM public._create_minutes_notification(
      v_chair_id,
      'minute_approver_delegate_selected',
      'انتخاب جانشین تأییدکننده',
      v_approver_name || '، ' || v_delegate_name || ' را به‌عنوان جانشین خود برای تأیید صورت‌جلسه انتخاب کرد.',
      'minute', v_approval.minute_id, v_approval.minute_id, v_minute_revision, v_user_id,
      v_context || jsonb_build_object('audience', 'chair'),
      v_event_key
    );
  END IF;

  -- Creator
  IF v_creator_id IS NOT NULL AND NOT (v_creator_id = ANY(v_seen)) THEN
    v_seen := array_append(v_seen, v_creator_id);
    v_event_key := 'minute:' || v_approval.minute_id::text || ':' || v_minute_revision::text
      || ':delegate_selected:' || p_approval_id::text
      || ':role:creator:' || v_creator_id::text;
    PERFORM public._create_minutes_notification(
      v_creator_id,
      'minute_approver_delegate_selected',
      'انتخاب جانشین تأییدکننده',
      v_approver_name || '، ' || v_delegate_name || ' را به‌عنوان جانشین خود برای تأیید صورت‌جلسه انتخاب کرد.',
      'minute', v_approval.minute_id, v_approval.minute_id, v_minute_revision, v_user_id,
      v_context || jsonb_build_object('audience', 'creator'),
      v_event_key
    );
  END IF;

  -- Other approvers of the same revision
  FOR v_recipient IN
    SELECT approver_user_id
    FROM public.minutes_approvals
    WHERE minute_id = v_approval.minute_id
    AND revision_number = v_minute_revision
    AND approver_user_id IS DISTINCT FROM v_user_id
    AND approver_user_id IS DISTINCT FROM p_delegate_user_id
    AND status = 'pending'
  LOOP
    IF v_recipient IS NULL OR v_recipient = ANY(v_seen) THEN
      CONTINUE;
    END IF;
    v_seen := array_append(v_seen, v_recipient);
    v_event_key := 'minute:' || v_approval.minute_id::text || ':' || v_minute_revision::text
      || ':delegate_selected:' || p_approval_id::text
      || ':approver:' || v_recipient::text;
    PERFORM public._create_minutes_notification(
      v_recipient,
      'minute_approver_delegate_selected',
      'انتخاب جانشین تأییدکننده',
      v_approver_name || '، ' || v_delegate_name || ' را به‌عنوان جانشین خود برای تأیید صورت‌جلسه انتخاب کرد.',
      'minute', v_approval.minute_id, v_approval.minute_id, v_minute_revision, v_user_id,
      v_context || jsonb_build_object('audience', 'approvers'),
      v_event_key
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'approval_id', p_approval_id,
    'delegate_user_id', p_delegate_user_id,
    'delegate_name', v_delegate_name,
    'message', 'جانشین با موفقیت انتخاب شد.'
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg_text = MESSAGE_TEXT;
    RETURN jsonb_build_object('success', false, 'error_code', v_msg_text,
      'sqlstate', 'P0001', 'message', v_msg_text);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_diag_sqlstate = RETURNED_SQLSTATE;
    RETURN jsonb_build_object('success', false, 'error_code', 'INTERNAL_ERROR',
      'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در انتخاب جانشین');
END;
$function$;

-- Revoke from PUBLIC and anon, grant only to authenticated
REVOKE EXECUTE ON FUNCTION public.assign_minutes_approval_delegate(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_minutes_approval_delegate(uuid, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_minutes_approval_delegate(uuid, uuid, timestamptz) TO authenticated;

-- ── 6. Modify approve_minute_revision to allow delegate action ───────────────

CREATE OR REPLACE FUNCTION public.approve_minute_revision(
  p_minute_id uuid,
  p_revision_number integer
)
RETURNS jsonb
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
  v_approval_row     public.minutes_approvals%ROWTYPE;
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

  -- Find approval where caller is either approver OR delegate
  SELECT * INTO v_approval_row
  FROM public.minutes_approvals
  WHERE minute_id = p_minute_id
  AND revision_number = p_revision_number
  AND (approver_user_id = v_user_id OR delegate_user_id = v_user_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  v_current_status := v_approval_row.status;

  IF v_current_status = 'approved' THEN
    RETURN jsonb_build_object('success', true, 'minute_id', p_minute_id,
      'status', 'already_approved', 'message', 'تأیید شما قبلاً ثبت شده است');
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  -- Update with acted_by_user_id
  UPDATE public.minutes_approvals
  SET status = 'approved', approved_at = now(), updated_at = now(), acted_by_user_id = v_user_id
  WHERE id = v_approval_row.id;

  PERFORM public._write_minutes_audit(
    p_minute_id, 'approval_given', 'approval', v_user_id, p_revision_number,
    NULL, jsonb_build_object('revision', p_revision_number,
      'acted_by_delegate', v_approval_row.delegate_user_id IS NOT NULL AND v_approval_row.delegate_user_id = v_user_id), NULL
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
$function$;

-- ── 7. Modify request_minutes_changes to allow delegate action ────────────────

CREATE OR REPLACE FUNCTION public.request_minutes_changes(
  p_minute_id uuid,
  p_revision_number integer,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
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
  v_approval_row      public.minutes_approvals%ROWTYPE;
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

  -- Find approval where caller is either approver OR delegate
  SELECT * INTO v_approval_row
  FROM public.minutes_approvals
  WHERE minute_id = p_minute_id
  AND revision_number = p_revision_number
  AND (approver_user_id = v_user_id OR delegate_user_id = v_user_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER' USING ERRCODE = 'P0001';
  END IF;

  IF v_approval_row.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  v_count := jsonb_array_length(p_items);
  v_first_reason := p_items->0->>'reason';

  -- Update with acted_by_user_id
  UPDATE public.minutes_approvals
  SET status = 'changes_requested', changes_requested_at = now(), updated_at = now(), acted_by_user_id = v_user_id
  WHERE id = v_approval_row.id;

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
$function$;

-- Re-grant execute on modified functions
REVOKE EXECUTE ON FUNCTION public.approve_minute_revision(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_minute_revision(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_minute_revision(uuid, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_minutes_changes(uuid, integer, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_minutes_changes(uuid, integer, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_minutes_changes(uuid, integer, jsonb) TO authenticated;
