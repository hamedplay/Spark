/*
# Add missing decision notification event types

## Problem
The function `public._create_minutes_notification` validates `p_event_type`
against a fixed allowlist. The decision RPC functions
(`update_my_minutes_decision`, `manage_minutes_decision`,
`resolve_my_minutes_decision_obstacle`) send the following event types that
are NOT in the allowlist:

  - decision_obstacle
  - decision_obstacle_resolved
  - decision_status_changed
  - decision_followup
  - decision_reopened

This caused the error `NOTIF_EVENT_TYPE_INVALID` whenever a user tried to
register an obstacle, resolve an obstacle, change status, record a follow-up,
or reopen a completed decision.

## Fix
Add the five missing event types to the allowlist inside
`_create_minutes_notification`. This is a purely additive change — no existing
event types are removed or renamed.

## Security
- No RLS changes.
- No new tables or columns.
- No data added, removed, or modified.
- SECURITY DEFINER, search_path '', and all grants preserved.
*/

CREATE OR REPLACE FUNCTION public._create_minutes_notification(
  p_recipient_user_id uuid,
  p_event_type        text,
  p_title             text,
  p_message           text,
  p_entity_type       text,
  p_entity_id         uuid,
  p_minute_id         uuid,
  p_revision_number   integer,
  p_actor_user_id     uuid,
  p_metadata          jsonb,
  p_event_key         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
    'decision_reopened'
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
$function$;

-- Preserve existing grants
GRANT EXECUTE ON FUNCTION public._create_minutes_notification(
  uuid, text, text, text, text, uuid, uuid, integer, uuid, jsonb, text
) TO authenticated;
