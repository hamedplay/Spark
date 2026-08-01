/*
# 1. Fix claim_due_overdue_decisions: m.title → m.meeting_title_snapshot
# 2. Add 'approvers' to allowed_audiences for minute_revision_invalidated
# 3. Disable minute_draft_created and minute_attachment_added in registry
*/

-- Fix 1: claim_due_overdue_decisions column name
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
    SELECT d.id AS decision_id, d.primary_owner_user_id, d.title, d.due_date,
           d.minute_id AS minute_id, m.meeting_title_snapshot AS minute_title
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
      'minute_title', COALESCE(v_rec.minute_title, ''),
      'decision_link', '#minutes-my-decisions?decision=' || v_rec.decision_id::text,
      'audience', 'decision_owner'
    );

    PERFORM public.resolve_and_queue_notification(
      'decision_due_soon', v_rec.primary_owner_user_id, 'decision_owner',
      'decision', v_rec.decision_id, v_rec.minute_id, NULL, v_context, v_idempotency, NULL
    );
  END LOOP;

  -- Overdue: due_date < today
  FOR v_rec IN
    SELECT d.id AS decision_id, d.primary_owner_user_id, d.title, d.due_date,
           d.minute_id AS minute_id, m.meeting_title_snapshot AS minute_title
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
      'minute_title', COALESCE(v_rec.minute_title, ''),
      'decision_link', '#minutes-my-decisions?decision=' || v_rec.decision_id::text,
      'audience', 'decision_owner'
    );

    PERFORM public.resolve_and_queue_notification(
      'decision_overdue', v_rec.primary_owner_user_id, 'decision_owner',
      'decision', v_rec.decision_id, v_rec.minute_id, NULL, v_context, v_idempotency, NULL
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_overdue_decisions(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_overdue_decisions(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_due_overdue_decisions(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_overdue_decisions(integer) TO service_role;

-- Fix 2: Add 'approvers' to allowed_audiences for minute_revision_invalidated
UPDATE public.notification_event_registry
SET allowed_audiences = ARRAY['creator', 'secretary', 'approvers', 'all']::text[]
WHERE event_key = 'minute_revision_invalidated';

-- Fix 3: Disable events without producers
UPDATE public.notification_event_registry
SET is_active = false
WHERE event_key IN ('minute_draft_created', 'minute_attachment_added');
