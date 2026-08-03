/*
# Fix assign_meeting_invitation_delegate: column alias in WHERE + text[] vs uuid[] type mismatch
#
# 1. Fix v_next_participants declaration: text[] -> uuid[]
# 2. Fix participant_user_ids construction: alias x used in WHERE of same SELECT (42703)
#    Replace with subquery using qualified column name q.user_id
# 3. Clear stale delegation metadata on delegate inbox ON CONFLICT UPDATE
# 4. Add p_metadata to all create_notification calls
# 5. Enhanced error logging with GET STACKED DIAGNOSTICS
#
# No previous migration edited. No data deleted. No CASCADE added.
*/

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
  v_next_participants uuid[];
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
  v_diag_msg         text;
  v_diag_detail      text;
  v_diag_hint        text;
  v_diag_context     text;
  v_inbox_updated_at timestamptz;
  v_notif_metadata   jsonb;
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

  -- Build notification metadata (shared across all notifications)
  v_notif_metadata := jsonb_build_object(
    'meeting_id', v_inbox.meeting_id,
    'meeting_subject', COALESCE(v_meeting.subject, ''),
    'meeting_date', COALESCE(v_meeting.request_date, ''),
    'start_time', COALESCE(v_meeting.start_time, ''),
    'end_time', COALESCE(v_meeting.end_time, ''),
    'location', COALESCE(v_meeting.location, ''),
    'represented_person_name', v_user_name,
    'representative_name', v_delegate_name,
    'organizer_name', v_organizer_name,
    'meeting_link', COALESCE(v_meeting.calendar_id, '')
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
    SELECT DISTINCT q.user_id
    FROM (
      SELECT unnest(
        COALESCE(v_meeting.participant_user_ids, '{}'::uuid[])
      ) AS user_id
      UNION ALL
      SELECT p_delegate_user_id
    ) q
    WHERE q.user_id IS NOT NULL
      AND q.user_id IS DISTINCT FROM v_user_id
  );

  UPDATE public.meetings
  SET participant_user_ids = v_next_participants
  WHERE id = v_inbox.meeting_id;

  -- 3. Create/update delegate's inbox entry with ON CONFLICT
  -- Clear stale delegation metadata from any prior declined inbox
  INSERT INTO public.meeting_inbox (meeting_id, user_id, status)
  VALUES (v_inbox.meeting_id, p_delegate_user_id, 'accepted')
  ON CONFLICT (meeting_id, user_id) DO UPDATE
  SET status = 'accepted',
      delegate_to = NULL,
      delegated_at = NULL,
      delegated_by_user_id = NULL,
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
    p_metadata := v_notif_metadata,
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
    p_metadata := v_notif_metadata,
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
      p_metadata := v_notif_metadata,
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
        p_metadata := v_notif_metadata,
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
        p_metadata := v_notif_metadata,
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
    GET STACKED DIAGNOSTICS
      v_diag_sqlstate = RETURNED_SQLSTATE,
      v_diag_msg = MESSAGE_TEXT,
      v_diag_detail = PG_EXCEPTION_DETAIL,
      v_diag_hint = PG_EXCEPTION_HINT,
      v_diag_context = PG_EXCEPTION_CONTEXT;
    RAISE LOG 'assign_meeting_invitation_delegate internal error: sqlstate=%, msg=%, detail=%, hint=%, context=%',
      v_diag_sqlstate, v_diag_msg, v_diag_detail, v_diag_hint, v_diag_context;
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INTERNAL_ERROR',
      'sqlstate', v_diag_sqlstate,
      'message', 'خطای داخلی در انتخاب جانشین دعوت جلسه'
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assign_meeting_invitation_delegate(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_meeting_invitation_delegate(uuid, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_meeting_invitation_delegate(uuid, uuid, timestamptz) TO authenticated;
