/*
# Claim due/overdue decisions for notification

New Function: claim_due_overdue_decisions(p_lead_days int)
- Finds decisions that are due soon (due_date = today + lead_days) or overdue (due_date < today)
- Queues outbox events via resolve_and_queue_notification
- Idempotency key per decision/event/date prevents duplicates
*/

CREATE OR REPLACE FUNCTION public.claim_due_overdue_decisions(p_lead_days int DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tehran')::date;
  v_due_soon_date date := v_today + p_lead_days;
  v_idempotency text;
  v_context jsonb;
  v_rec record;
BEGIN
  -- Due soon: due_date = today + lead_days
  FOR v_rec IN
    SELECT d.id AS decision_id, d.primary_owner_user_id, d.title, d.due_date
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    WHERE d.status NOT IN ('completed', 'stopped')
      AND d.primary_owner_user_id IS NOT NULL
      AND d.due_date = v_due_soon_date
      AND m.status IN ('published', 'approved')
  LOOP
    v_idempotency := 'decision:' || v_rec.decision_id::text || ':decision_due_soon:' || v_today::text || ':' || v_rec.primary_owner_user_id::text;
    v_context := jsonb_build_object(
      'decision_title', v_rec.title,
      'decision_due_date', v_rec.due_date::text,
      'decision_link', '#minutes-my-decisions?decision=' || v_rec.decision_id::text,
      'audience', 'decision_owner'
    );

    PERFORM public.resolve_and_queue_notification(
      'decision_due_soon', v_rec.primary_owner_user_id, 'decision_owner',
      'decision', v_rec.decision_id, NULL, NULL, v_context, v_idempotency, NULL
    );
  END LOOP;

  -- Overdue: due_date < today
  FOR v_rec IN
    SELECT d.id AS decision_id, d.primary_owner_user_id, d.title, d.due_date
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    WHERE d.status NOT IN ('completed', 'stopped')
      AND d.primary_owner_user_id IS NOT NULL
      AND d.due_date < v_today
      AND m.status IN ('published', 'approved')
  LOOP
    v_idempotency := 'decision:' || v_rec.decision_id::text || ':decision_overdue:' || v_today::text || ':' || v_rec.primary_owner_user_id::text;
    v_context := jsonb_build_object(
      'decision_title', v_rec.title,
      'decision_due_date', v_rec.due_date::text,
      'decision_link', '#minutes-my-decisions?decision=' || v_rec.decision_id::text,
      'audience', 'decision_owner'
    );

    PERFORM public.resolve_and_queue_notification(
      'decision_overdue', v_rec.primary_owner_user_id, 'decision_owner',
      'decision', v_rec.decision_id, NULL, NULL, v_context, v_idempotency, NULL
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_overdue_decisions(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_overdue_decisions(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_due_overdue_decisions(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_overdue_decisions(integer) TO service_role;
