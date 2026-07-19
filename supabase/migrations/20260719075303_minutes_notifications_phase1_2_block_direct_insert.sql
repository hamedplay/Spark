/*
# Minutes Notifications — Phase 1.2: block direct INSERT of Minutes/Decision notifications

## Problem
The existing INSERT policy "Authenticated users can insert notifications"
only checks `auth.uid() IS NOT NULL`. Any authenticated user could directly
INSERT a forged Minutes/Decision notification with an arbitrary recipient
user_id, actor_user_id, minute_id and event_key.

## Fix
Replace the single permissive INSERT policy with a scoped one that still
allows legacy client-side notifications (chat, meeting, calendar, etc.) but
rejects any direct INSERT whose entity_type is 'minutes' or 'decision' or
whose template_event_type is one of the Minutes/Decision event types.

Minutes/Decision notifications are only created inside SECURITY DEFINER
RPCs (which bypass RLS), so the tighter CHECK does not affect them.

## No rewrite of prior migrations
This is a corrective migration that drops and recreates only the INSERT
policy. SELECT/UPDATE/DELETE policies and the admin-read policy are
untouched. The helper function is extended to persist the event type in
the existing `template_event_type` column so the bell can route by it.
*/

-- 1. Store event type in template_event_type so the bell can route by it
CREATE OR REPLACE FUNCTION public._create_minutes_notification(
  p_recipient_user_id uuid,
  p_event_type text,
  p_title text,
  p_message text,
  p_entity_type text,
  p_entity_id uuid,
  p_minute_id uuid,
  p_revision_number integer,
  p_actor_user_id uuid,
  p_metadata jsonb,
  p_event_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    'decision_stopped'
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

REVOKE EXECUTE ON FUNCTION public._create_minutes_notification(
  uuid, text, text, text, text, uuid, uuid, integer, uuid, jsonb, text
) FROM anon, authenticated;

-- 2. Replace the permissive INSERT policy with a scoped one
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

CREATE POLICY "Authenticated users can insert non-minutes notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND COALESCE(entity_type, '') NOT IN ('minutes', 'decision')
    AND COALESCE(template_event_type, '') NOT IN (
      'minutes_approval_requested',
      'minutes_all_approved',
      'minutes_changes_requested',
      'minutes_resubmitted',
      'minutes_secretary_confirmed',
      'minutes_published',
      'decision_assigned',
      'decision_completed',
      'decision_waiting_approval',
      'decision_stopped'
    )
  );
