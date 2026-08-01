/*
# Hub counter RPC for Minutes module

1. New Functions
- `get_my_minutes_hub_counts()` — returns a single JSON row with
  per-card counts for the Minutes hub page.
  Counts:
    minutes_unread: unread notifications where entity_type='minute' for current user
    approvals_pending: minutes_approvals with status='pending' for current user as approver
    my_decisions_unread: unread notifications where entity_type='decision' for current user
    my_decisions_active: decisions owned by current user with status not in ('completed','stopped')
    followup_actionable: distinct decisions with at least one overdue/overdue-or-due followup condition

2. Security
- SECURITY DEFINER, search_path=''
- No user-id parameter; identity from auth.uid()
- Returns only counts, no row data
- TO authenticated EXECUTE only

3. Notes
- Idempotent: safe to re-run
- Does not modify any data
- Does not bypass RLS for user-visible rows; only aggregates counts
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

  -- Unread minute notifications
  SELECT count(*) INTO v_minutes_unread
  FROM public.notifications
  WHERE user_id = v_user_id
    AND read = false
    AND entity_type = 'minute';

  -- Pending approvals for current user
  SELECT count(*) INTO v_approvals_pending
  FROM public.minutes_approvals ma
  WHERE ma.approver_user_id = v_user_id
    AND ma.status = 'pending';

  -- Unread decision notifications
  SELECT count(*) INTO v_my_decisions_unread
  FROM public.notifications
  WHERE user_id = v_user_id
    AND read = false
    AND entity_type = 'decision';

  -- Active decisions owned by current user
  SELECT count(*) INTO v_my_decisions_active
  FROM public.minutes_decisions
  WHERE primary_owner_user_id = v_user_id
    AND status NOT IN ('completed', 'stopped');

  -- Followup actionable: distinct decisions that have at least one
  -- pending followup reminder due, OR are overdue (due_date < now and not completed/stopped)
  SELECT count(DISTINCT d.id) INTO v_followup_actionable
  FROM public.minutes_decisions d
  WHERE d.primary_owner_user_id = v_user_id
    AND d.status NOT IN ('completed', 'stopped')
    AND (
      -- Has a pending reminder that is due
      EXISTS (
        SELECT 1 FROM public.minutes_decision_reminders r
        WHERE r.decision_id = d.id
          AND r.recipient_user_id = v_user_id
          AND r.status = 'pending'
          AND r.remind_at <= now()
      )
      -- Or overdue
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

GRANT EXECUTE ON FUNCTION public.get_my_minutes_hub_counts() TO authenticated;
