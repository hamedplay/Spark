-- Match the unfiltered get_trackable_minutes_decisions list: same permission
-- predicate, leaf decisions, obstacle event type, and follow-up flag.
-- Keep the public RPC signature, owner and existing function ACLs unchanged.
CREATE OR REPLACE FUNCTION private.get_trackable_minutes_decisions_summary()
RETURNS TABLE(
  total_count integer,
  active_count integer,
  completed_count integer,
  stopped_count integer,
  overdue_count integer,
  open_obstacle_count integer,
  requires_followup_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Tehran')::date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE d.status IN (
      'not_started', 'planned', 'in_progress',
      'waiting_coordination', 'waiting_approval'
    ))::integer,
    count(*) FILTER (WHERE d.status = 'completed')::integer,
    count(*) FILTER (WHERE d.status = 'stopped')::integer,
    count(*) FILTER (WHERE d.due_date < v_today
      AND d.status NOT IN ('completed', 'stopped'))::integer,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.minutes_decision_updates u
      WHERE u.decision_id = d.id
        AND u.event_type = 'obstacle'
        AND u.is_blocking = true
        AND u.resolved_at IS NULL
    ))::integer,
    count(*) FILTER (WHERE d.requires_followup = true)::integer
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE public._can_track_decisions(d.minute_id)
    AND (
      d.parent_decision_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.minutes_decisions c
        WHERE c.parent_decision_id = d.id
      )
    );
END;
$function$;
