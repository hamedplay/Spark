/*
# Update claim_notification_outbox_rows:
# 1. Return notification_attempt_count and sms_attempt_count
# 2. Claim pending, stuck processing, partial with next_attempt_at, failed with next_attempt_at
# 3. Do NOT claim terminal rows (failed with null next_attempt_at, processed)
*/

DROP FUNCTION IF EXISTS public.claim_notification_outbox_rows(integer);

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
  notification_attempt_count integer,
  sms_attempt_count integer,
  idempotency_key text,
  notification_status text,
  sms_status text,
  sms_sent_at timestamptz
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
      OR
      (status = 'partial' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now())
      OR
      (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now())
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
    o.payload, o.attempt_count,
    o.notification_attempt_count, o.sms_attempt_count,
    o.idempotency_key,
    o.notification_status, o.sms_status, o.sms_sent_at
  FROM public.notification_outbox o
  WHERE o.id = ANY(v_claimed_ids)
  ORDER BY o.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_outbox_rows(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_notification_outbox_rows(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_notification_outbox_rows(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_rows(integer) TO service_role;
