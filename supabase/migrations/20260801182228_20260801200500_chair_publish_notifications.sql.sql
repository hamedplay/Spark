/*
# Add notifications to confirm_and_publish_minutes_by_chair

- minute_chair_confirmed to secretary+creator
- minute_published to creator, secretary, chair, participants, decision owners (deduplicated)
*/

CREATE OR REPLACE FUNCTION public.confirm_and_publish_minutes_by_chair(
  p_minute_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
  v_secretary_id      uuid;
  v_chair_id          uuid;
  v_creator_id        uuid;
  v_minute_title      text;
  v_revision          integer;
  v_context           jsonb;
  v_recipient          uuid;
  v_audience          text;
  v_seen              uuid[] := '{}'::uuid[];
  v_event_key         text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, approval_mode, updated_at, secretary_user_id, chair_user_id, created_by_user_id, title, revision_number
    INTO v_status, v_mode, v_existing_updated_at, v_secretary_id, v_chair_id, v_creator_id, v_minute_title, v_revision
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

  -- ── Notifications ──────────────────────────────────────────────────────
  v_context := public._get_minute_notif_context(p_minute_id);

  -- minute_chair_confirmed to secretary and creator (not to actor)
  FOREACH v_recipient IN ARRAY ARRAY[v_secretary_id, v_creator_id] LOOP
    IF v_recipient IS NULL THEN CONTINUE; END IF;
    IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_recipient);
    IF v_recipient IS DISTINCT FROM v_user_id THEN
      v_audience := CASE WHEN v_recipient = v_secretary_id THEN 'secretary' ELSE 'creator' END;
      v_event_key := 'minute:' || p_minute_id::text || ':' || v_revision::text || ':minute_chair_confirmed:' || v_recipient::text;
      PERFORM public._create_minutes_notification(
        v_recipient, 'minute_chair_confirmed',
        'تأیید رئیس جلسه', 'رئیس جلسه صورت‌جلسه را تأیید کرد.',
        'minute', p_minute_id, p_minute_id, v_revision, v_user_id,
        v_context || jsonb_build_object('audience', v_audience),
        v_event_key
      );
    END IF;
  END LOOP;

  -- minute_published to creator, secretary, chair, participants, decision owners (deduplicated)
  v_seen := '{}'::uuid[];
  FOREACH v_recipient IN ARRAY ARRAY[v_secretary_id, v_chair_id, v_creator_id] LOOP
    IF v_recipient IS NULL THEN CONTINUE; END IF;
    IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_recipient);
    IF v_recipient IS DISTINCT FROM v_user_id THEN
      v_event_key := 'minute:' || p_minute_id::text || ':' || v_revision::text || ':minute_published:' || v_recipient::text;
      PERFORM public._create_minutes_notification(
        v_recipient, 'minute_published',
        'انتشار صورت‌جلسه', 'صورت‌جلسه منتشر شد.',
        'minute', p_minute_id, p_minute_id, v_revision, v_user_id,
        v_context || jsonb_build_object('audience', 'all'),
        v_event_key
      );
    END IF;
  END LOOP;

  -- Notify participants
  FOR v_recipient IN
    SELECT DISTINCT mp.user_id FROM public.minutes_participants mp
    WHERE mp.minute_id = p_minute_id AND mp.user_id IS NOT NULL
  LOOP
    IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_recipient);
    IF v_recipient IS DISTINCT FROM v_user_id THEN
      v_event_key := 'minute:' || p_minute_id::text || ':' || v_revision::text || ':minute_published:' || v_recipient::text;
      PERFORM public._create_minutes_notification(
        v_recipient, 'minute_published',
        'انتشار صورت‌جلسه', 'صورت‌جلسه منتشر شد.',
        'minute', p_minute_id, p_minute_id, v_revision, v_user_id,
        v_context || jsonb_build_object('audience', 'participants'),
        v_event_key
      );
    END IF;
  END LOOP;

  -- Notify decision owners
  FOR v_recipient IN
    SELECT DISTINCT d.primary_owner_user_id FROM public.minutes_decisions d
    WHERE d.minute_id = p_minute_id AND d.primary_owner_user_id IS NOT NULL
  LOOP
    IF v_recipient = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_recipient);
    IF v_recipient IS DISTINCT FROM v_user_id THEN
      v_event_key := 'minute:' || p_minute_id::text || ':' || v_revision::text || ':minute_published:' || v_recipient::text;
      PERFORM public._create_minutes_notification(
        v_recipient, 'minute_published',
        'انتشار صورت‌جلسه', 'صورت‌جلسه منتشر شد. مصوبات شما اکنون قابل پیگیری است.',
        'minute', p_minute_id, p_minute_id, v_revision, v_user_id,
        v_context || jsonb_build_object('audience', 'decision_owner'),
        v_event_key
      );
    END IF;
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
$$;
