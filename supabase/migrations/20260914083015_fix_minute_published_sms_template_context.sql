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
  SELECT
    id,
    meeting_title_snapshot,
    revision_number,
    secretary_user_id,
    chair_user_id,
    created_by_user_id,
    status,
    meeting_id
  INTO v_minute
  FROM public.minutes
  WHERE id = p_minute_id;

  IF NOT FOUND THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT subject, request_date, start_time
  INTO v_meeting
  FROM public.meetings
  WHERE id = v_minute.meeting_id;

  RETURN jsonb_build_object(
    'minute_title', COALESCE(v_minute.meeting_title_snapshot, ''),
    'minute_revision', COALESCE(v_minute.revision_number::text, ''),
    'minute_status', COALESCE(v_minute.status, ''),
    'minute_id', p_minute_id::text,
    'meeting_subject', COALESCE(v_meeting.subject, ''),
    'meeting_date', COALESCE(v_meeting.request_date::text, ''),
    'minute_link', '#minutes-detail?id=' || p_minute_id::text
  );
END;
$function$;

UPDATE public.sms_templates
SET
  body = 'صورتجلسه جلسه «{{minute_title}}» در تاریخ {{meeting_date}} منتشر شد. برای مشاهده جزئیات وارد سامانه شوید.',
  placeholders = ARRAY['minute_title', 'meeting_date']::text[],
  is_active = true,
  updated_at = now()
WHERE category = 'minutes'
  AND event_type = 'minute_published'
  AND audience = 'all';
