/*
# Claim notification outbox rows — FOR UPDATE SKIP LOCKED

1. New Function
- `claim_notification_outbox_rows(p_limit int)` — atomically claims pending/failed outbox rows
  using FOR UPDATE SKIP LOCKED. Reclaims rows stuck in 'processing' for > 5 minutes.
  Returns claimed rows with payload for dispatch.

2. Security
- SECURITY DEFINER, search_path=''
- TO service_role only (called by outbox worker edge function)

3. Notes
- Idempotent: safe to re-run
- Handles crash recovery: processing rows older than 5 minutes are reclaimed
*/

CREATE OR REPLACE FUNCTION public.claim_notification_outbox_rows(p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  event_key text,
  category text,
  entity_type text,
  entity_id uuid,
  minute_id uuid,
  actor_user_id uuid,
  recipient_id uuid,
  audience text,
  payload jsonb,
  attempt_count integer,
  idempotency_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stuck_threshold timestamptz := now() - interval '5 minutes';
  v_claimed_ids uuid[];
BEGIN
  SELECT array_agg(sub.id) INTO v_claimed_ids
  FROM (
    SELECT id FROM public.notification_outbox
    WHERE (
      (status = 'pending' AND next_attempt_at <= now())
      OR
      (status = 'processing' AND next_attempt_at < v_stuck_threshold)
    )
    ORDER BY created_at ASC
    LIMIT LEAST(p_limit, 100)
    FOR UPDATE SKIP LOCKED
  ) sub;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.notification_outbox
  SET status = 'processing', next_attempt_at = now()
  WHERE id = ANY(v_claimed_ids);

  RETURN QUERY
  SELECT
    o.id, o.event_key, o.category, o.entity_type, o.entity_id,
    o.minute_id, o.actor_user_id, o.recipient_id, o.audience,
    o.payload, o.attempt_count, o.idempotency_key
  FROM public.notification_outbox o
  WHERE o.id = ANY(v_claimed_ids)
  ORDER BY o.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_outbox_rows(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_notification_outbox_rows(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_notification_outbox_rows(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_rows(integer) TO service_role;
