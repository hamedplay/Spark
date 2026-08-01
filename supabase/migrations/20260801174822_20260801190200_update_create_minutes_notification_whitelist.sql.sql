/*
# Update _create_minutes_notification event type whitelist

Add missing event types:
- decision_followup_due
- decision_progress_updated
- decision_overdue
- decision_due_soon

The existing whitelist already covers:
  minutes_approval_requested, minutes_all_approved, minutes_changes_requested,
  minutes_resubmitted, minutes_secretary_confirmed, minutes_published,
  decision_assigned, decision_completed, decision_waiting_approval,
  decision_stopped, decision_obstacle, decision_obstacle_resolved,
  decision_status_changed, decision_followup, decision_reopened
*/

CREATE OR REPLACE FUNCTION public._create_minutes_notification(
  p_recipient_user_id uuid,
  p_event_type text,
  p_title text,
  p_message text,
  p_entity_type text DEFAULT 'meeting',
  p_entity_id uuid DEFAULT NULL::uuid,
  p_minute_id uuid DEFAULT NULL::uuid,
  p_revision_number integer DEFAULT NULL::integer,
  p_actor_user_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_event_key text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'NOTIF_RECIPIENT_NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_type IS NULL OR p_event_type NOT IN (
    'minutes_approval_requested',
    'minutes_all_approved',
    'minutes_changes_requested',
    'minutes_resubmitted',
    'minutes_secretary_confirmed',
    'minutes_published',
    'decision_assigned',
    'decision_completed',
    'decision_waiting_approval',
    'decision_stopped',
    'decision_obstacle',
    'decision_obstacle_resolved',
    'decision_status_changed',
    'decision_followup',
    'decision_followup_due',
    'decision_progress_updated',
    'decision_reopened',
    'decision_overdue',
    'decision_due_soon'
  ) THEN
    RAISE EXCEPTION 'NOTIF_EVENT_TYPE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.notifications (
      user_id, title, message, type, read,
      entity_type, entity_id, minute_id, revision_number,
      actor_user_id, metadata, event_key,
      template_event_type,
      created_at
    ) VALUES (
      p_recipient_user_id, p_title, p_message, 'meeting', false,
      p_entity_type, p_entity_id, p_minute_id, p_revision_number,
      p_actor_user_id, p_metadata, p_event_key,
      p_event_type,
      now()
    );
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;
