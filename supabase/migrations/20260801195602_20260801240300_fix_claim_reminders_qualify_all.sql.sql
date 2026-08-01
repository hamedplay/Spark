/*
# Fix claim_due_minutes_decision_reminders: fully qualify all column references
*/

CREATE OR REPLACE FUNCTION public.claim_due_minutes_decision_reminders(p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  decision_id uuid,
  minute_id uuid,
  recipient_user_id uuid,
  decision_title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stuck_threshold timestamptz := now() - interval '10 minutes';
  v_claimed_ids uuid[];
BEGIN
  SELECT array_agg(sub.rid) INTO v_claimed_ids
  FROM (
    SELECT r.id AS rid
    FROM public.minutes_decision_reminders r
    WHERE (
      (r.status = 'pending' AND r.remind_at <= now())
      OR
      (r.status = 'processing' AND r.updated_at < v_stuck_threshold)
    )
    ORDER BY r.remind_at ASC
    LIMIT LEAST(p_limit, 100)
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.minutes_decision_reminders r
  SET status = 'processing', updated_at = now()
  WHERE r.id = ANY(v_claimed_ids);

  RETURN QUERY
  SELECT
    r.id,
    r.decision_id,
    r.minute_id,
    r.recipient_user_id,
    d.title AS decision_title
  FROM public.minutes_decision_reminders r
  JOIN public.minutes_decisions d ON d.id = r.decision_id
  WHERE r.id = ANY(v_claimed_ids)
  ORDER BY r.remind_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_minutes_decision_reminders(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_minutes_decision_reminders(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_due_minutes_decision_reminders(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_minutes_decision_reminders(integer) TO service_role;
