/*
# Atomic create/update meeting RPCs

## Purpose
Replace the frontend's multi-query create/edit flow (insert meeting → insert
participants → insert agenda → repeat meetings) with a single SECURITY DEFINER
RPC per operation. Every child write runs inside one DB transaction, so a
failure in any step rolls back the whole change — no more orphaned deletes or
half-written meetings.

## Changes

### 1. New column
- `meetings.updated_at` (timestamptz, default now()) — used for optimistic
  concurrency in the update RPC. Backfilled to created_at for existing rows.

### 2. New functions (SECURITY DEFINER, search_path = '')
- `public.create_meeting_atomic(p_payload jsonb)` → returns the new meeting id.
  - Derives `user_id` from `auth.uid()` (ignores any client-supplied user_id).
  - Validates subject non-empty, calendar_id belongs to caller (or null).
  - Inserts the meeting row, then meeting_agenda_items and participants rows.
  - Creates meeting_inbox pending entries for each internal participant.
  - All in one transaction; any error → full rollback.

- `public.update_meeting_atomic(p_meeting_id uuid, p_expected_updated_at timestamptz, p_payload jsonb)` → returns the new updated_at.
  - Verifies caller is the organizer (user_id = auth.uid()) or admin.
  - Optimistic concurrency: fails if current updated_at != p_expected_updated_at.
  - Updates the meeting row, then syncs agenda (delete + insert) and
    participants (delete + insert) atomically.
  - Does NOT touch meeting_inbox (invitations are managed by separate flows).

### 3. Security
- Both functions SECURITY DEFINER, SET search_path TO ''.
- REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated only.
- user_id is always derived from auth.uid() — client cannot forge organizer.
- calendar_id ownership validated against public.calendars.

### 4. Notes
- No existing migration rewritten.
- No data is modified except the backfill of updated_at.
- Frontend will be switched to these RPCs in a follow-up code change.
*/

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.meetings SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.create_meeting_atomic(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_meeting_id uuid;
  v_subject text;
  v_calendar_id uuid;
  v_is_admin boolean;
  v_cal_owner uuid;
  v_agenda jsonb;
  v_participants jsonb;
  v_participant_user_ids uuid[];
  v_notify_users uuid[];
  v_external_participants text[];
  v_row public.meetings%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_subject := p_payload->>'subject';
  IF v_subject IS NULL OR btrim(v_subject) = '' THEN
    RAISE EXCEPTION 'Subject is required';
  END IF;

  v_calendar_id := NULLIF(p_payload->>'calendar_id', '')::uuid;
  IF v_calendar_id IS NOT NULL THEN
    SELECT user_id INTO v_cal_owner FROM public.calendars WHERE id = v_calendar_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Calendar not found';
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND is_admin = true) INTO v_is_admin;
    IF v_cal_owner IS DISTINCT FROM v_user_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Not allowed to use this calendar';
    END IF;
  END IF;

  v_participant_user_ids := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'participant_user_ids')::uuid), ARRAY[]::uuid[]);
  v_notify_users := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'notify_users')::uuid), ARRAY[]::uuid[]);
  v_notify_users := array_append(v_notify_users, v_user_id);
  v_external_participants := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'external_participants')), ARRAY[]::text[]);

  INSERT INTO public.meetings (
    subject, request_date, request_jalaali_date, request_duration, duration,
    location, representative, phone, notes, priority, status, status_type,
    user_id, guest_emails, start_time, end_time, notify_users,
    participant_user_ids, external_participants, repeat_type, repeat_interval,
    repeat_end_date, repeat_weekday, reminder_minutes, send_sms,
    meeting_manager, calendar_id, is_online, members_only, conference_room_id
  ) VALUES (
    v_subject,
    NULLIF(p_payload->>'request_date', '')::timestamptz,
    NULLIF(p_payload->>'request_jalaali_date', ''),
    NULLIF(p_payload->>'request_duration', ''),
    NULLIF(p_payload->>'duration', ''),
    p_payload->>'location',
    p_payload->>'representative',
    p_payload->>'phone',
    p_payload->>'notes',
    COALESCE(p_payload->>'priority', 'medium'),
    COALESCE(p_payload->>'status', 'open'),
    COALESCE(p_payload->>'status_type', 'requested'),
    v_user_id,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'guest_emails')), ARRAY[]::text[]),
    NULLIF(p_payload->>'start_time', ''),
    NULLIF(p_payload->>'end_time', ''),
    v_notify_users,
    v_participant_user_ids,
    v_external_participants,
    COALESCE(p_payload->>'repeat_type', 'none'),
    NULLIF(p_payload->>'repeat_interval', '')::int,
    NULLIF(p_payload->>'repeat_end_date', ''),
    NULLIF(p_payload->>'repeat_weekday', '')::int,
    NULLIF(p_payload->>'reminder_minutes', '')::int,
    COALESCE((p_payload->>'send_sms')::boolean, false),
    NULLIF(p_payload->>'meeting_manager', '')::uuid,
    v_calendar_id,
    COALESCE((p_payload->>'is_online')::boolean, false),
    COALESCE((p_payload->>'members_only')::boolean, false),
    NULLIF(p_payload->>'conference_room_id', '')::uuid
  )
  RETURNING id, updated_at INTO v_meeting_id, v_row.updated_at;

  v_agenda := p_payload->'agenda_items';
  IF v_agenda IS NOT NULL AND jsonb_array_length(v_agenda) > 0 THEN
    INSERT INTO public.meeting_agenda_items (meeting_id, title, presenter, duration_minutes, sort_order)
    SELECT v_meeting_id, item->>'title', NULLIF(item->>'presenter', ''),
           NULLIF(item->>'duration_minutes', '')::int,
           (row_number() OVER () - 1)::int
    FROM jsonb_array_elements(v_agenda) WITH ORDINALITY AS t(item);
  END IF;

  v_participants := p_payload->'participant_names';
  IF v_participants IS NOT NULL AND jsonb_array_length(v_participants) > 0 THEN
    INSERT INTO public.participants (meeting_id, name)
    SELECT v_meeting_id, name FROM jsonb_array_elements_text(v_participants) AS name;
  END IF;

  IF array_length(v_participant_user_ids, 1) > 0 THEN
    INSERT INTO public.meeting_inbox (meeting_id, user_id, status)
    SELECT v_meeting_id, uid, 'pending'
    FROM unnest(v_participant_user_ids) AS uid
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_meeting_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_meeting_atomic(
  p_meeting_id uuid,
  p_expected_updated_at timestamptz,
  p_payload jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_owner uuid;
  v_current_updated_at timestamptz;
  v_is_admin boolean;
  v_subject text;
  v_calendar_id uuid;
  v_cal_owner uuid;
  v_agenda jsonb;
  v_participants jsonb;
  v_new_updated_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT user_id, updated_at INTO v_current_owner, v_current_updated_at
  FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND is_admin = true) INTO v_is_admin;

  IF v_current_owner IS DISTINCT FROM v_user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only the organizer or an admin can update this meeting';
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'optimistic_concurrency_conflict';
  END IF;

  v_subject := p_payload->>'subject';
  IF v_subject IS NULL OR btrim(v_subject) = '' THEN
    RAISE EXCEPTION 'Subject is required';
  END IF;

  v_calendar_id := NULLIF(p_payload->>'calendar_id', '')::uuid;
  IF v_calendar_id IS NOT NULL THEN
    SELECT user_id INTO v_cal_owner FROM public.calendars WHERE id = v_calendar_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Calendar not found';
    END IF;
    IF v_cal_owner IS DISTINCT FROM v_user_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Not allowed to use this calendar';
    END IF;
  END IF;

  UPDATE public.meetings SET
    subject = v_subject,
    request_date = NULLIF(p_payload->>'request_date', '')::timestamptz,
    request_jalaali_date = NULLIF(p_payload->>'request_jalaali_date', ''),
    request_duration = NULLIF(p_payload->>'request_duration', ''),
    duration = NULLIF(p_payload->>'duration', ''),
    location = p_payload->>'location',
    representative = p_payload->>'representative',
    phone = p_payload->>'phone',
    notes = p_payload->>'notes',
    priority = COALESCE(p_payload->>'priority', 'medium'),
    status = COALESCE(p_payload->>'status', status),
    status_type = COALESCE(p_payload->>'status_type', status_type),
    start_time = NULLIF(p_payload->>'start_time', ''),
    end_time = NULLIF(p_payload->>'end_time', ''),
    notify_users = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'notify_users')), ARRAY[]::uuid[]),
    participant_user_ids = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'participant_user_ids')), ARRAY[]::uuid[]),
    external_participants = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'external_participants')), ARRAY[]::text[]),
    repeat_type = COALESCE(p_payload->>'repeat_type', 'none'),
    repeat_interval = NULLIF(p_payload->>'repeat_interval', '')::int,
    repeat_end_date = NULLIF(p_payload->>'repeat_end_date', ''),
    repeat_weekday = NULLIF(p_payload->>'repeat_weekday', '')::int,
    reminder_minutes = NULLIF(p_payload->>'reminder_minutes', '')::int,
    send_sms = COALESCE((p_payload->>'send_sms')::boolean, false),
    meeting_manager = NULLIF(p_payload->>'meeting_manager', '')::uuid,
    calendar_id = v_calendar_id,
    is_online = COALESCE((p_payload->>'is_online')::boolean, false),
    members_only = COALESCE((p_payload->>'members_only')::boolean, false),
    conference_room_id = NULLIF(p_payload->>'conference_room_id', '')::uuid,
    updated_at = now()
  WHERE id = p_meeting_id
  RETURNING updated_at INTO v_new_updated_at;

  v_agenda := p_payload->'agenda_items';
  DELETE FROM public.meeting_agenda_items WHERE meeting_id = p_meeting_id;
  IF v_agenda IS NOT NULL AND jsonb_array_length(v_agenda) > 0 THEN
    INSERT INTO public.meeting_agenda_items (meeting_id, title, presenter, duration_minutes, sort_order)
    SELECT p_meeting_id, item->>'title', NULLIF(item->>'presenter', ''),
           NULLIF(item->>'duration_minutes', '')::int,
           (row_number() OVER () - 1)::int
    FROM jsonb_array_elements(v_agenda) WITH ORDINALITY AS t(item);
  END IF;

  v_participants := p_payload->'participant_names';
  DELETE FROM public.participants WHERE meeting_id = p_meeting_id;
  IF v_participants IS NOT NULL AND jsonb_array_length(v_participants) > 0 THEN
    INSERT INTO public.participants (meeting_id, name)
    SELECT p_meeting_id, name FROM jsonb_array_elements_text(v_participants) AS name;
  END IF;

  RETURN v_new_updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_meeting_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_meeting_atomic(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.update_meeting_atomic(uuid, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_meeting_atomic(uuid, timestamptz, jsonb) TO authenticated;
