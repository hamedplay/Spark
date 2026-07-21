-- Fix: inbox branch of conflict query did not exclude the candidate meeting itself.
-- If a user had multiple inbox rows for the same meeting, or was both organizer and
-- had an inbox row, the candidate meeting appeared as a self-conflict.
-- Additive: CREATE OR REPLACE with same signature, same grants, same output shape.
-- Only change: AND m.id <> v_meeting_id in the inbox branch.

CREATE OR REPLACE FUNCTION public.accept_meeting_invitation_v2(
  p_meeting_inbox_id uuid,
  p_allow_conflict boolean DEFAULT false
)
RETURNS TABLE(
  accepted boolean,
  requires_confirmation boolean,
  meeting_id uuid,
  conflicts jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_inbox public.meeting_inbox%ROWTYPE;
  v_meeting_id uuid;
  v_candidate_date text;
  v_candidate_start text;
  v_candidate_end text;
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_inbox
  FROM public.meeting_inbox AS mi
  WHERE mi.id = p_meeting_inbox_id
    AND mi.user_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_meeting_id := v_inbox.meeting_id;

  IF v_inbox.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT m.request_date, m.start_time, m.end_time
  INTO v_candidate_date, v_candidate_start, v_candidate_end
  FROM public.meetings AS m
  WHERE m.id = v_meeting_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND';
  END IF;

  IF v_candidate_start IS NOT NULL AND v_candidate_end IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'meeting_id', c.id,
      'title', c.subject,
      'meeting_date', c.request_date,
      'start_time', c.start_time,
      'end_time', c.end_time
    ) ORDER BY c.request_date, c.start_time), '[]'::jsonb)
    INTO v_conflicts
    FROM (
      SELECT m.id, m.subject, m.request_date, m.start_time, m.end_time, m.user_id
      FROM public.meetings AS m
      WHERE m.user_id = v_caller
        AND m.id <> v_meeting_id
        AND m.start_time IS NOT NULL
        AND m.end_time IS NOT NULL
        AND m.request_date = v_candidate_date
        AND m.start_time < v_candidate_end
        AND v_candidate_start < m.end_time
      UNION
      SELECT m.id, m.subject, m.request_date, m.start_time, m.end_time, mi.user_id
      FROM public.meeting_inbox AS mi
      JOIN public.meetings AS m ON m.id = mi.meeting_id
      WHERE mi.user_id = v_caller
        AND mi.id <> p_meeting_inbox_id
        AND m.id <> v_meeting_id
        AND mi.status IN ('pending','accepted')
        AND m.start_time IS NOT NULL
        AND m.end_time IS NOT NULL
        AND m.request_date = v_candidate_date
        AND m.start_time < v_candidate_end
        AND v_candidate_start < m.end_time
    ) AS c;
  END IF;

  IF jsonb_array_length(v_conflicts) = 0 THEN
    UPDATE public.meeting_inbox AS mi
    SET status = 'accepted'
    WHERE mi.id = v_inbox.id;

    RETURN QUERY SELECT true, false, v_meeting_id, '[]'::jsonb;
    RETURN;
  END IF;

  IF p_allow_conflict IS NOT TRUE THEN
    RETURN QUERY SELECT false, true, v_meeting_id, v_conflicts;
    RETURN;
  END IF;

  UPDATE public.meeting_inbox AS mi
  SET status = 'accepted'
  WHERE mi.id = v_inbox.id AND mi.user_id = v_caller;

  RETURN QUERY SELECT true, false, v_meeting_id, v_conflicts;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_meeting_invitation_v2(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_meeting_invitation_v2(uuid, boolean) TO authenticated;