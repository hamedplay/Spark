/*
# Meeting Invitation Delegate — Atomic, Independent Delegation for Meeting Invitations

## Summary

This migration implements an independent, atomic delegation model for meeting
invitations, separate from minutes approval delegation. An invitee can assign a
delegate who attends the meeting on their behalf. The original invitee's inbox
row is preserved with status `delegated`; the delegate gets an `accepted` inbox
row so the meeting appears in their calendar immediately.

## 1. Extend notification_event_registry category check to include 'meeting'

The existing CHECK constraint only allows 'minutes' and 'decision'. We add
'meeting' so meeting-specific events can be registered.

## 2. New Columns on `public.meeting_inbox`

- `delegated_at` (timestamptz, nullable) — when delegation was set
- `delegated_by_user_id` (uuid, nullable) — the original invitee who delegated
- `updated_at` (timestamptz, nullable) — for optimistic concurrency control

No CASCADE on any FK. Deleting a user nullifies the reference, never deletes
the inbox row or meeting history.

## 3. New RPC: `assign_meeting_invitation_delegate`

SECURITY DEFINER, SET search_path = ''. Only `authenticated` can EXECUTE.
All operations in a single transaction — failure rolls back everything.

## 4. New Notification Event Types (category: meeting)

- `meeting_invitation_delegate_assigned` — to the delegate
- `meeting_invitation_delegate_selected` — to other stakeholders
- `meeting_invitation_delegation_confirmed` — to the original invitee

## 5. New Audiences: representatives, delegators

## Important Notes

1. No existing migration is edited.
2. No data is deleted, reset, truncated, or cascaded.
3. The `delegate-meeting` Edge Function is preserved.
4. `meeting/change` event is NEVER fired during delegation.
5. Deduplication via unique `event_key` on `notifications` table.
*/

-- ── 1. Extend notification_event_registry category check ──────────────────────

ALTER TABLE public.notification_event_registry
  DROP CONSTRAINT IF EXISTS notification_event_registry_category_check;

ALTER TABLE public.notification_event_registry
  ADD CONSTRAINT notification_event_registry_category_check
  CHECK (category = ANY (ARRAY['minutes'::text, 'decision'::text, 'meeting'::text]));

-- ── 2. Add delegate columns to meeting_inbox ──────────────────────────────────

ALTER TABLE public.meeting_inbox
  ADD COLUMN IF NOT EXISTS delegated_at timestamptz,
  ADD COLUMN IF NOT EXISTS delegated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.meeting_inbox SET updated_at = created_at WHERE updated_at IS NULL;

-- ── 3. New event registry entries ─────────────────────────────────────────────

INSERT INTO public.notification_event_registry
  (event_key, category, entity_type, label_fa, notification_enabled, sms_supported, group_rule_supported, allowed_audiences, required_placeholders, optional_placeholders, is_active)
VALUES
  (
    'meeting_invitation_delegate_assigned',
    'meeting', 'meeting',
    'انتخاب به‌عنوان جانشین دعوت جلسه',
    true, true, true,
    ARRAY['all', 'representatives'],
    ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'represented_person_name'],
    ARRAY['location', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link', 'meeting_time'],
    true
  ),
  (
    'meeting_invitation_delegate_selected',
    'meeting', 'meeting',
    'انتخاب جانشین دعوت جلسه',
    true, false, true,
    ARRAY['all', 'participants', 'observers', 'organizer'],
    ARRAY['meeting_subject', 'represented_person_name', 'representative_name'],
    ARRAY['meeting_date', 'start_time', 'end_time', 'location', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link'],
    true
  ),
  (
    'meeting_invitation_delegation_confirmed',
    'meeting', 'meeting',
    'تأیید ثبت جانشین دعوت جلسه',
    true, false, true,
    ARRAY['all', 'delegators'],
    ARRAY['meeting_subject', 'representative_name'],
    ARRAY['meeting_date', 'start_time', 'end_time', 'location', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link'],
    true
  )
ON CONFLICT (event_key) DO NOTHING;

-- ── 4. Add representatives and delegators audiences to change/cancel events ──

INSERT INTO public.notification_event_registry
  (event_key, category, entity_type, label_fa, notification_enabled, sms_supported, group_rule_supported, allowed_audiences, required_placeholders, optional_placeholders, is_active)
SELECT 'change', 'meeting', 'meeting', 'تغییر جلسه', true, true, true,
  ARRAY['all', 'participants', 'observers', 'organizer', 'representatives', 'delegators'],
  ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time'],
  ARRAY['location', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link', 'meeting_time', 'location_part'],
  true
WHERE NOT EXISTS (SELECT 1 FROM public.notification_event_registry WHERE event_key = 'change' AND category = 'meeting');

INSERT INTO public.notification_event_registry
  (event_key, category, entity_type, label_fa, notification_enabled, sms_supported, group_rule_supported, allowed_audiences, required_placeholders, optional_placeholders, is_active)
SELECT 'cancel', 'meeting', 'meeting', 'لغو جلسه', true, true, true,
  ARRAY['all', 'participants', 'observers', 'organizer', 'representatives', 'delegators'],
  ARRAY['meeting_subject', 'meeting_date'],
  ARRAY['start_time', 'end_time', 'location', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link', 'meeting_time', 'location_part'],
  true
WHERE NOT EXISTS (SELECT 1 FROM public.notification_event_registry WHERE event_key = 'cancel' AND category = 'meeting');

-- ── 5. Notification templates (conflict-safe) ─────────────────────────────────

INSERT INTO public.notification_templates
  (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES
  (
    'meeting', 'meeting_invitation_delegate_assigned', 'all',
    'انتخاب به‌عنوان جانشین دعوت جلسه',
    '{{recipient_greeting}}، شما به‌عنوان جانشین {{represented_person_name}} برای شرکت در جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} انتخاب شده‌اید.',
    'user-check', 'blue',
    ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'location', 'represented_person_name', 'recipient_greeting', 'full_name', 'meeting_link', 'meeting_time'],
    true
  ),
  (
    'meeting', 'meeting_invitation_delegate_selected', 'all',
    'انتخاب جانشین دعوت جلسه',
    '{{represented_person_name}}، {{representative_name}} را به‌عنوان جانشین خود برای شرکت در جلسه «{{meeting_subject}}» انتخاب کرد.',
    'users', 'blue',
    ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'location', 'represented_person_name', 'representative_name', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link'],
    true
  ),
  (
    'meeting', 'meeting_invitation_delegation_confirmed', 'all',
    'تأیید ثبت جانشین دعوت جلسه',
    '{{recipient_greeting}}، {{representative_name}} با موفقیت به‌عنوان جانشین شما برای جلسه «{{meeting_subject}}» ثبت شد.',
    'check-circle', 'green',
    ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'location', 'representative_name', 'recipient_greeting', 'full_name', 'meeting_link'],
    true
  ),
  (
    'meeting', 'change', 'representatives',
    'تغییر جلسه (جانشین)',
    'جلسه‌ای که به‌عنوان جانشین {{represented_person_name}} در آن شرکت می‌کنید تغییر کرده است.',
    'clock', 'amber',
    ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'location', 'represented_person_name', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link', 'meeting_time', 'location_part'],
    true
  ),
  (
    'meeting', 'change', 'delegators',
    'تغییر جلسه (واگذارنده)',
    'جلسه تغییر کرده و جانشین ثبت‌شده شما {{representative_name}} است.',
    'clock', 'amber',
    ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'location', 'representative_name', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link', 'meeting_time', 'location_part'],
    true
  ),
  (
    'meeting', 'cancel', 'representatives',
    'لغو جلسه (جانشین)',
    'جلسه‌ای که به‌عنوان جانشین {{represented_person_name}} در آن شرکت می‌کردید لغو شد.',
    'x-circle', 'red',
    ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'location', 'represented_person_name', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link', 'meeting_time', 'location_part'],
    true
  ),
  (
    'meeting', 'cancel', 'delegators',
    'لغو جلسه (واگذارنده)',
    'جلسه لغو شد. جانشین ثبت‌شده شما {{representative_name}} بود.',
    'x-circle', 'red',
    ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'location', 'representative_name', 'organizer_name', 'recipient_greeting', 'full_name', 'meeting_link', 'meeting_time', 'location_part'],
    true
  )
ON CONFLICT DO NOTHING;

-- ── 6. SMS template for delegate-assigned ──────────────────────────────────────

INSERT INTO public.sms_templates
  (category, event_type, audience, subject, body, placeholders, is_active)
VALUES
  (
    'meeting', 'meeting_invitation_delegate_assigned', 'all',
    'انتخاب به‌عنوان جانشین دعوت جلسه',
    '{{recipient_greeting}}، شما به‌عنوان جانشین {{represented_person_name}} برای شرکت در جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} انتخاب شده‌اید.',
    ARRAY['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'represented_person_name', 'recipient_greeting', 'full_name'],
    true
  )
ON CONFLICT DO NOTHING;

-- ── 7. assign_meeting_invitation_delegate RPC ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_meeting_invitation_delegate(
  p_meeting_inbox_id uuid,
  p_delegate_user_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id          uuid;
  v_inbox            public.meeting_inbox%ROWTYPE;
  v_meeting          record;
  v_next_participants text[];
  v_delegate_org     text;
  v_user_org         text;
  v_delegate_name    text;
  v_user_name        text;
  v_organizer_name   text;
  v_recipient        uuid;
  v_seen             uuid[] := '{}'::uuid[];
  v_event_key        text;
  v_msg_text         text;
  v_diag_sqlstate    text;
  v_inbox_updated_at timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inbox
  FROM public.meeting_inbox
  WHERE id = p_meeting_inbox_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INBOX_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_inbox.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'NOT_INBOX_OWNER' USING ERRCODE = 'P0001';
  END IF;

  IF p_delegate_user_id = v_user_id THEN
    RAISE EXCEPTION 'CANNOT_DELEGATE_TO_SELF' USING ERRCODE = 'P0001';
  END IF;

  IF v_inbox.status <> 'pending' THEN
    RAISE EXCEPTION 'INBOX_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  IF v_inbox.delegate_to IS NOT NULL THEN
    RAISE EXCEPTION 'DELEGATE_ALREADY_ASSIGNED' USING ERRCODE = 'P0001';
  END IF;

  v_inbox_updated_at := COALESCE(v_inbox.updated_at, v_inbox.created_at);
  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_inbox_updated_at THEN
    RAISE EXCEPTION 'INBOX_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, user_id, subject, request_date, start_time, end_time, location,
         participant_user_ids, notify_users, calendar_id
  INTO v_meeting
  FROM public.meetings
  WHERE id = v_inbox.meeting_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_delegate_user_id = v_meeting.user_id THEN
    RAISE EXCEPTION 'DELEGATE_IS_ORGANIZER' USING ERRCODE = 'P0001';
  END IF;

  IF v_meeting.participant_user_ids IS NOT NULL AND p_delegate_user_id = ANY(v_meeting.participant_user_ids) THEN
    RAISE EXCEPTION 'DELEGATE_ALREADY_PARTICIPANT' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.meeting_inbox
    WHERE meeting_id = v_inbox.meeting_id
    AND user_id = p_delegate_user_id
    AND status IN ('pending', 'accepted', 'delegated')
  ) THEN
    RAISE EXCEPTION 'DELEGATE_ALREADY_INVITED' USING ERRCODE = 'P0001';
  END IF;

  SELECT organization INTO v_delegate_org
  FROM public.profiles
  WHERE user_id = p_delegate_user_id
  AND is_active = true
  AND COALESCE(is_hidden, false) = false
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELEGATE_PROFILE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT organization INTO v_user_org
  FROM public.profiles
  WHERE user_id = v_user_id
  LIMIT 1;

  IF COALESCE(v_user_org, '') <> COALESCE(v_delegate_org, '') THEN
    RAISE EXCEPTION 'DELEGATE_DIFFERENT_ORG' USING ERRCODE = 'P0001';
  END IF;

  v_user_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_user_id LIMIT 1),
    'کاربر'
  );
  v_delegate_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = p_delegate_user_id LIMIT 1),
    'جانشین'
  );
  v_organizer_name := COALESCE(
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE user_id = v_meeting.user_id LIMIT 1),
    'سازنده جلسه'
  );

  -- 1. Update original inbox: mark as delegated
  UPDATE public.meeting_inbox
  SET status = 'delegated',
      delegate_to = p_delegate_user_id,
      delegated_by_user_id = v_user_id,
      delegated_at = now(),
      updated_at = now()
  WHERE id = p_meeting_inbox_id;

  -- 2. Update meeting participants: remove original user, add delegate (deduplicated)
  v_next_participants := ARRAY(
    SELECT DISTINCT x FROM (
      SELECT unnest(v_meeting.participant_user_ids) AS x
      WHERE x IS DISTINCT FROM v_user_id
      UNION ALL
      SELECT p_delegate_user_id
    ) sub
  );

  UPDATE public.meetings
  SET participant_user_ids = v_next_participants
  WHERE id = v_inbox.meeting_id;

  -- 3. Create/update delegate's inbox entry with ON CONFLICT
  INSERT INTO public.meeting_inbox (meeting_id, user_id, status)
  VALUES (v_inbox.meeting_id, p_delegate_user_id, 'accepted')
  ON CONFLICT (meeting_id, user_id) DO UPDATE
  SET status = 'accepted',
      delegate_to = NULL,
      updated_at = now();

  -- ── Notifications ────────────────────────────────────────────────────────

  -- Notification 1: to delegate — meeting_invitation_delegate_assigned
  v_event_key := 'meeting:' || v_inbox.meeting_id::text || ':delegate-assigned:'
    || v_user_id::text || ':' || p_delegate_user_id::text;

  PERFORM public.create_notification(
    p_user_id := p_delegate_user_id,
    p_title := 'انتخاب به‌عنوان جانشین دعوت جلسه',
    p_message := v_user_name || ' شما را به‌عنوان جانشین خود برای شرکت در جلسه «' || COALESCE(v_meeting.subject, '') || '» انتخاب کرد.',
    p_type := 'meeting',
    p_action_url := 'calendar',
    p_template_category := 'meeting',
    p_template_event_type := 'meeting_invitation_delegate_assigned',
    p_template_audience := 'all',
    p_entity_type := 'meeting',
    p_entity_id := v_inbox.meeting_id,
    p_event_key := v_event_key
  );

  -- Notification 2: to original user — meeting_invitation_delegation_confirmed
  v_event_key := 'meeting:' || v_inbox.meeting_id::text || ':delegation-confirmed:'
    || v_user_id::text || ':' || p_delegate_user_id::text;

  PERFORM public.create_notification(
    p_user_id := v_user_id,
    p_title := 'تأیید ثبت جانشین دعوت جلسه',
    p_message := v_delegate_name || ' با موفقیت به‌عنوان جانشین شما برای جلسه «' || COALESCE(v_meeting.subject, '') || '» ثبت شد.',
    p_type := 'meeting',
    p_action_url := 'calendar',
    p_template_category := 'meeting',
    p_template_event_type := 'meeting_invitation_delegation_confirmed',
    p_template_audience := 'all',
    p_entity_type := 'meeting',
    p_entity_id := v_inbox.meeting_id,
    p_event_key := v_event_key
  );

  -- Notification 3: to other stakeholders — meeting_invitation_delegate_selected
  v_seen := ARRAY[v_user_id, p_delegate_user_id];

  -- Organizer
  IF v_meeting.user_id IS NOT NULL AND NOT (v_meeting.user_id = ANY(v_seen)) THEN
    v_seen := array_append(v_seen, v_meeting.user_id);
    v_event_key := 'meeting:' || v_inbox.meeting_id::text || ':delegate-selected:'
      || v_user_id::text || ':' || p_delegate_user_id::text || ':organizer:' || v_meeting.user_id::text;

    PERFORM public.create_notification(
      p_user_id := v_meeting.user_id,
      p_title := 'انتخاب جانشین دعوت جلسه',
      p_message := v_user_name || '، ' || v_delegate_name || ' را به‌عنوان جانشین خود برای شرکت در جلسه «' || COALESCE(v_meeting.subject, '') || '» انتخاب کرد.',
      p_type := 'meeting',
      p_action_url := 'calendar',
      p_template_category := 'meeting',
      p_template_event_type := 'meeting_invitation_delegate_selected',
      p_template_audience := 'organizer',
      p_entity_type := 'meeting',
      p_entity_id := v_inbox.meeting_id,
      p_event_key := v_event_key
    );
  END IF;

  -- Other participants
  IF v_meeting.participant_user_ids IS NOT NULL THEN
    FOREACH v_recipient IN ARRAY v_meeting.participant_user_ids LOOP
      IF v_recipient IS NULL OR v_recipient = ANY(v_seen) THEN
        CONTINUE;
      END IF;
      v_seen := array_append(v_seen, v_recipient);
      v_event_key := 'meeting:' || v_inbox.meeting_id::text || ':delegate-selected:'
        || v_user_id::text || ':' || p_delegate_user_id::text || ':participant:' || v_recipient::text;

      PERFORM public.create_notification(
        p_user_id := v_recipient,
        p_title := 'انتخاب جانشین دعوت جلسه',
        p_message := v_user_name || '، ' || v_delegate_name || ' را به‌عنوان جانشین خود برای شرکت در جلسه «' || COALESCE(v_meeting.subject, '') || '» انتخاب کرد.',
        p_type := 'meeting',
        p_action_url := 'calendar',
        p_template_category := 'meeting',
        p_template_event_type := 'meeting_invitation_delegate_selected',
        p_template_audience := 'participants',
        p_entity_type := 'meeting',
        p_entity_id := v_inbox.meeting_id,
        p_event_key := v_event_key
      );
    END LOOP;
  END IF;

  -- Notify users
  IF v_meeting.notify_users IS NOT NULL THEN
    FOREACH v_recipient IN ARRAY v_meeting.notify_users LOOP
      IF v_recipient IS NULL OR v_recipient = ANY(v_seen) THEN
        CONTINUE;
      END IF;
      v_seen := array_append(v_seen, v_recipient);
      v_event_key := 'meeting:' || v_inbox.meeting_id::text || ':delegate-selected:'
        || v_user_id::text || ':' || p_delegate_user_id::text || ':observer:' || v_recipient::text;

      PERFORM public.create_notification(
        p_user_id := v_recipient,
        p_title := 'انتخاب جانشین دعوت جلسه',
        p_message := v_user_name || '، ' || v_delegate_name || ' را به‌عنوان جانشین خود برای شرکت در جلسه «' || COALESCE(v_meeting.subject, '') || '» انتخاب کرد.',
        p_type := 'meeting',
        p_action_url := 'calendar',
        p_template_category := 'meeting',
        p_template_event_type := 'meeting_invitation_delegate_selected',
        p_template_audience := 'observers',
        p_entity_type := 'meeting',
        p_entity_id := v_inbox.meeting_id,
        p_event_key := v_event_key
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'meeting_id', v_inbox.meeting_id,
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
      'sqlstate', v_diag_sqlstate, 'message', 'خطای داخلی در انتخاب جانشین دعوت جلسه');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assign_meeting_invitation_delegate(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_meeting_invitation_delegate(uuid, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_meeting_invitation_delegate(uuid, uuid, timestamptz) TO authenticated;
