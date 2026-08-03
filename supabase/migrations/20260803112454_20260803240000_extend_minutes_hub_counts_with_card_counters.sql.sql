/*
# Extend get_my_minutes_hub_counts with per-card total/open/closed counters

## Purpose
- Adds 6 new fields to the existing JSON output:
  minutes_total, minutes_open, minutes_closed
  approvals_total, approvals_open, approvals_closed
  my_decisions_total, my_decisions_open, my_decisions_closed
  followup_total, followup_open, followup_closed
  dashboard_minutes_total, dashboard_minutes_open, dashboard_minutes_closed
  dashboard_decisions_total, dashboard_decisions_open, dashboard_decisions_closed
  reports_total, reports_open, reports_closed
- Preserves all existing fields (minutes_unread, approvals_pending,
  my_decisions_unread, my_decisions_active, followup_actionable) unchanged.

## Definitions
- Minutes card: total = viewable minutes; open = non-published; closed = published.
- Approvals card: current revision only; open = pending; closed = approved/changes_requested/invalidated.
- My decisions card: published decisions owned by user; open = not completed/stopped; closed = completed/stopped.
- Followup card: decisions in _can_track_decisions scope; same open/closed definitions.
- Dashboard card: total minutes + decisions viewable; same open/closed definitions.
- Reports card: published minutes in report scope; open = has >=1 open decision; closed = no open decisions.

## Security
- SECURITY DEFINER, search_path = '' preserved.
- GRANT EXECUTE TO authenticated only — no anon/PUBLIC access.
- No RLS changes. No data deletion or modification.
*/

CREATE OR REPLACE FUNCTION public.get_my_minutes_hub_counts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();

  -- Existing fields (preserved)
  v_minutes_unread int;
  v_approvals_pending int;
  v_my_decisions_unread int;
  v_my_decisions_active int;
  v_followup_actionable int;

  -- New per-card counters
  v_minutes_total int;
  v_minutes_open int;
  v_minutes_closed int;

  v_approvals_total int;
  v_approvals_open int;
  v_approvals_closed int;

  v_my_decisions_total int;
  v_my_decisions_open int;
  v_my_decisions_closed int;

  v_followup_total int;
  v_followup_open int;
  v_followup_closed int;

  v_dash_minutes_total int;
  v_dash_minutes_open int;
  v_dash_minutes_closed int;
  v_dash_decisions_total int;
  v_dash_decisions_open int;
  v_dash_decisions_closed int;

  v_reports_total int;
  v_reports_open int;
  v_reports_closed int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object(
      'minutes_unread', 0, 'approvals_pending', 0,
      'my_decisions_unread', 0, 'my_decisions_active', 0,
      'followup_actionable', 0,
      'minutes_total', 0, 'minutes_open', 0, 'minutes_closed', 0,
      'approvals_total', 0, 'approvals_open', 0, 'approvals_closed', 0,
      'my_decisions_total', 0, 'my_decisions_open', 0, 'my_decisions_closed', 0,
      'followup_total', 0, 'followup_open', 0, 'followup_closed', 0,
      'dashboard_minutes_total', 0, 'dashboard_minutes_open', 0, 'dashboard_minutes_closed', 0,
      'dashboard_decisions_total', 0, 'dashboard_decisions_open', 0, 'dashboard_decisions_closed', 0,
      'reports_total', 0, 'reports_open', 0, 'reports_closed', 0
    );
  END IF;

  -- ── Existing unread/pending counts (preserved) ──────────────────────────

  SELECT count(*) INTO v_minutes_unread
  FROM public.notifications
  WHERE user_id = v_user_id AND read = false
  AND (template_category = 'minutes' OR (template_category IS NULL AND entity_type = 'minute'));

  SELECT count(*) INTO v_approvals_pending
  FROM public.minutes_approvals ma
  JOIN public.minutes m ON m.id = ma.minute_id
  WHERE ma.approver_user_id = v_user_id AND ma.status = 'pending'
  AND ma.revision_number = m.revision_number AND m.status = 'pending_approval';

  SELECT count(*) INTO v_my_decisions_unread
  FROM public.notifications
  WHERE user_id = v_user_id AND read = false
  AND (template_category = 'decision' OR (template_category IS NULL AND entity_type = 'decision'));

  SELECT count(*) INTO v_my_decisions_active
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE d.primary_owner_user_id = v_user_id
  AND d.status NOT IN ('completed', 'stopped')
  AND m.status = 'published' AND m.published_at IS NOT NULL;

  SELECT count(DISTINCT d.id) INTO v_followup_actionable
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE d.primary_owner_user_id = v_user_id
  AND d.status NOT IN ('completed', 'stopped')
  AND m.status = 'published' AND m.published_at IS NOT NULL
  AND (
    EXISTS (SELECT 1 FROM public.minutes_decision_reminders r
      WHERE r.decision_id = d.id AND r.recipient_user_id = v_user_id
      AND r.status = 'pending' AND r.remind_at <= now())
    OR (d.due_date IS NOT NULL AND d.due_date::date < now()::date)
  );

  -- ── Minutes card: viewable minutes ──────────────────────────────────────

  SELECT count(*),
         count(*) FILTER (WHERE m.status <> 'published'),
         count(*) FILTER (WHERE m.status = 'published')
  INTO v_minutes_total, v_minutes_open, v_minutes_closed
  FROM public.minutes m
  WHERE public._user_can_view_minute(m.id);

  -- ── Approvals card: current revision only ───────────────────────────────

  SELECT count(*),
         count(*) FILTER (WHERE ma.status = 'pending'),
         count(*) FILTER (WHERE ma.status IN ('approved', 'changes_requested', 'invalidated'))
  INTO v_approvals_total, v_approvals_open, v_approvals_closed
  FROM public.minutes_approvals ma
  JOIN public.minutes m ON m.id = ma.minute_id
  WHERE ma.approver_user_id = v_user_id
  AND ma.revision_number = m.revision_number;

  -- ── My decisions card: published, owned by user ─────────────────────────

  SELECT count(*),
         count(*) FILTER (WHERE d.status NOT IN ('completed', 'stopped')),
         count(*) FILTER (WHERE d.status IN ('completed', 'stopped'))
  INTO v_my_decisions_total, v_my_decisions_open, v_my_decisions_closed
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE d.primary_owner_user_id = v_user_id
  AND m.status = 'published' AND m.published_at IS NOT NULL;

  -- ── Followup card: _can_track_decisions scope ───────────────────────────

  SELECT count(DISTINCT d.id),
         count(DISTINCT d.id) FILTER (WHERE d.status NOT IN ('completed', 'stopped')),
         count(DISTINCT d.id) FILTER (WHERE d.status IN ('completed', 'stopped'))
  INTO v_followup_total, v_followup_open, v_followup_closed
  FROM public.minutes_decisions d
  WHERE public._can_track_decisions(d.minute_id);

  -- ── Dashboard card: viewable minutes + viewable decisions ───────────────

  SELECT count(*),
         count(*) FILTER (WHERE m.status <> 'published'),
         count(*) FILTER (WHERE m.status = 'published')
  INTO v_dash_minutes_total, v_dash_minutes_open, v_dash_minutes_closed
  FROM public.minutes m
  WHERE public._user_can_view_minute(m.id);

  SELECT count(*),
         count(*) FILTER (WHERE d.status NOT IN ('completed', 'stopped')),
         count(*) FILTER (WHERE d.status IN ('completed', 'stopped'))
  INTO v_dash_decisions_total, v_dash_decisions_open, v_dash_decisions_closed
  FROM public.minutes_decisions d
  WHERE public._user_can_view_minute(d.minute_id);

  -- ── Reports card: published minutes in report scope ─────────────────────
  -- open = has at least one open (non-completed/stopped) decision
  -- closed = no open decisions

  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.minutes_decisions d
           WHERE d.minute_id = m.id
           AND d.status NOT IN ('completed', 'stopped')
         )),
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.minutes_decisions d
           WHERE d.minute_id = m.id
           AND d.status NOT IN ('completed', 'stopped')
         ))
  INTO v_reports_total, v_reports_open, v_reports_closed
  FROM public.minutes m
  WHERE public._user_can_view_minute(m.id)
  AND m.status = 'published' AND m.published_at IS NOT NULL;

  RETURN json_build_object(
    'minutes_unread', v_minutes_unread,
    'approvals_pending', v_approvals_pending,
    'my_decisions_unread', v_my_decisions_unread,
    'my_decisions_active', v_my_decisions_active,
    'followup_actionable', v_followup_actionable,
    'minutes_total', v_minutes_total,
    'minutes_open', v_minutes_open,
    'minutes_closed', v_minutes_closed,
    'approvals_total', v_approvals_total,
    'approvals_open', v_approvals_open,
    'approvals_closed', v_approvals_closed,
    'my_decisions_total', v_my_decisions_total,
    'my_decisions_open', v_my_decisions_open,
    'my_decisions_closed', v_my_decisions_closed,
    'followup_total', v_followup_total,
    'followup_open', v_followup_open,
    'followup_closed', v_followup_closed,
    'dashboard_minutes_total', v_dash_minutes_total,
    'dashboard_minutes_open', v_dash_minutes_open,
    'dashboard_minutes_closed', v_dash_minutes_closed,
    'dashboard_decisions_total', v_dash_decisions_total,
    'dashboard_decisions_open', v_dash_decisions_open,
    'dashboard_decisions_closed', v_dash_decisions_closed,
    'reports_total', v_reports_total,
    'reports_open', v_reports_open,
    'reports_closed', v_reports_closed
  );
END;
$function$;

-- Preserve existing GRANT (authenticated only, no anon/PUBLIC)
GRANT EXECUTE ON FUNCTION public.get_my_minutes_hub_counts() TO authenticated;
