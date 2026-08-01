/*
# Claim due minutes decision reminders with FOR UPDATE SKIP LOCKED

1. New Function
- `claim_due_minutes_decision_reminders(p_limit int)` — atomically claims
  pending reminders that are due, using FOR UPDATE SKIP LOCKED.
  Also reclaims reminders stuck in 'processing' for > 10 minutes.
  Returns claimed rows with decision title for notification content.

2. Security
- SECURITY DEFINER, search_path=''
- TO authenticated EXECUTE only (scheduler calls with service role)
- Handles crash recovery: processing reminders older than 10 minutes are reclaimed

3. Notes
- Idempotent: safe to re-run
- Returns: id, decision_id, minute_id, recipient_user_id, decision_title
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
  SELECT array_agg(sub.id) INTO v_claimed_ids
  FROM (
    SELECT id FROM public.minutes_decision_reminders
    WHERE (
      (status = 'pending' AND remind_at <= now())
      OR
      (status = 'processing' AND updated_at < v_stuck_threshold)
    )
    ORDER BY remind_at ASC
    LIMIT LEAST(p_limit, 100)
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.minutes_decision_reminders
  SET status = 'processing', updated_at = now()
  WHERE id = ANY(v_claimed_ids);

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

GRANT EXECUTE ON FUNCTION public.claim_due_minutes_decision_reminders(int) TO authenticated;
