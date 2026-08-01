/*
# Update get_my_minutes_hub_counts to use template_category

- minutes_unread: notifications WHERE read=false AND template_category='minutes'
- my_decisions_unread: notifications WHERE read=false AND template_category='decision'
- approvals_pending: only current revision pending approvals where minute status='pending_approval'
*/

CREATE OR REPLACE FUNCTION public.get_my_minutes_hub_counts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_minutes_unread int;
  v_approvals_pending int;
  v_my_decisions_unread int;
  v_my_decisions_active int;
  v_followup_actionable int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object(
      'minutes_unread', 0,
      'approvals_pending', 0,
      'my_decisions_unread', 0,
      'my_decisions_active', 0,
      'followup_actionable', 0
    );
  END IF;

  -- Unread minute notifications (by template_category, fallback to entity_type)
  SELECT count(*) INTO v_minutes_unread
  FROM public.notifications
  WHERE user_id = v_user_id
    AND read = false
    AND (template_category = 'minutes' OR (template_category IS NULL AND entity_type = 'minute'));

  -- Pending approvals for current user on current revision only
  SELECT count(*) INTO v_approvals_pending
  FROM public.minutes_approvals ma
  JOIN public.minutes m ON m.id = ma.minute_id
  WHERE ma.approver_user_id = v_user_id
    AND ma.status = 'pending'
    AND ma.revision_number = m.revision_number
    AND m.status = 'pending_approval';

  -- Unread decision notifications
  SELECT count(*) INTO v_my_decisions_unread
  FROM public.notifications
  WHERE user_id = v_user_id
    AND read = false
    AND (template_category = 'decision' OR (template_category IS NULL AND entity_type = 'decision'));

  -- Active decisions owned by current user
  SELECT count(*) INTO v_my_decisions_active
  FROM public.minutes_decisions
  WHERE primary_owner_user_id = v_user_id
    AND status NOT IN ('completed', 'stopped');

  -- Followup actionable
  SELECT count(DISTINCT d.id) INTO v_followup_actionable
  FROM public.minutes_decisions d
  WHERE d.primary_owner_user_id = v_user_id
    AND d.status NOT IN ('completed', 'stopped')
    AND (
      EXISTS (
        SELECT 1 FROM public.minutes_decision_reminders r
        WHERE r.decision_id = d.id
          AND r.recipient_user_id = v_user_id
          AND r.status = 'pending'
          AND r.remind_at <= now()
      )
      OR (
        d.due_date IS NOT NULL
        AND d.due_date::date < now()::date
      )
    );

  RETURN json_build_object(
    'minutes_unread', v_minutes_unread,
    'approvals_pending', v_approvals_pending,
    'my_decisions_unread', v_my_decisions_unread,
    'my_decisions_active', v_my_decisions_active,
    'followup_actionable', v_followup_actionable
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_minutes_hub_counts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_minutes_hub_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_minutes_hub_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_minutes_hub_counts() TO service_role;
