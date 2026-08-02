/*
# Fix _get_minute_notif_context: reference correct column name

## Problem
The function `public._get_minute_notif_context` referenced a non-existent
column `public.minutes.title` in its SELECT statement. The correct column is
`meeting_title_snapshot`. This caused SQLSTATE 42703 (undefined_column)
whenever the function was invoked — notably during minutes submit-for-approval,
which calls `_create_minutes_notification` → `_get_minute_notif_context`.

## Root cause
  SELECT id, title, ...  -- "title" does not exist on public.minutes
Should be:
  SELECT id, meeting_title_snapshot, ...

## Fix
Replace `title` with `meeting_title_snapshot` in the SELECT column list and
in the jsonb_build_object output (`minute_title`).

## Security
- No RLS policy changes.
- No table or column changes.
- SECURITY DEFINER, LANGUAGE plpgsql, SET search_path TO '' — all preserved.
- No GRANT changes (function is private, called internally by other SECURITY
  DEFINER functions).
*/

CREATE OR REPLACE FUNCTION public._get_minute_notif_context(p_minute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_minute record;
  v_meeting record;
BEGIN
  SELECT id, meeting_title_snapshot, revision_number, secretary_user_id, chair_user_id, created_by_user_id, status, meeting_id
  INTO v_minute
  FROM public.minutes WHERE id = p_minute_id;

  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT subject, start_time INTO v_meeting
  FROM public.meetings WHERE id = v_minute.meeting_id;

  RETURN jsonb_build_object(
    'minute_title', COALESCE(v_minute.meeting_title_snapshot, ''),
    'minute_revision', COALESCE(v_minute.revision_number::text, ''),
    'minute_status', COALESCE(v_minute.status, ''),
    'minute_id', p_minute_id::text,
    'meeting_subject', COALESCE(v_meeting.subject, ''),
    'minute_link', '#minutes-detail?id=' || p_minute_id::text
  );
END;
$function$;
