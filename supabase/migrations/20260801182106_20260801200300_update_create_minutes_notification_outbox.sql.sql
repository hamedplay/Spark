/*
# Update _create_minutes_notification to use templates + outbox

1. Changes to existing function
- _create_minutes_notification now:
  a) Looks up notification_template by category + event_type + audience (fallback to 'all')
  b) Renders {{placeholder}} from p_metadata context
  c) Calls resolve_and_queue_notification to insert into outbox
  d) No longer directly inserts into notifications table
  e) Uses canonical minute_ prefix (not minutes_)

2. Event key normalization
- Maps legacy minutes_* event types to canonical minute_* (e.g., minutes_published → minute_published)
- This allows existing RPC callers to work without changes while canonical keys are used internally

3. Notes
- No existing data modified
- No existing migrations changed
- Function is SECURITY DEFINER so it can call resolve_and_queue_notification (service_role only)
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
DECLARE
  v_canonical_event text;
  v_category text;
  v_entity_type_resolved text;
  v_audience text;
  v_context jsonb;
  v_idempotency text;
BEGIN
  IF p_recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'NOTIF_RECIPIENT_NULL' USING ERRCODE = 'P0001';
  END IF;

  -- Normalize event type: minutes_* → minute_* (canonical)
  v_canonical_event := CASE
    WHEN p_event_type LIKE 'minutes_%' THEN 'minute_' || substring(p_event_type from 9)
    WHEN p_event_type LIKE 'minute_%' THEN p_event_type
    ELSE p_event_type
  END;

  -- Determine category from event prefix
  v_category := CASE
    WHEN v_canonical_event LIKE 'minute_%' THEN 'minutes'
    WHEN v_canonical_event LIKE 'decision_%' THEN 'decision'
    ELSE 'meeting'
  END;

  -- Resolve entity_type
  v_entity_type_resolved := COALESCE(p_entity_type, CASE WHEN v_category = 'minutes' THEN 'minute' ELSE 'decision' END);

  -- Determine audience from metadata or default to 'all'
  v_audience := COALESCE(p_metadata->>'audience', 'all');

  -- Build context for placeholder rendering
  v_context := COALESCE(p_metadata, '{}'::jsonb) ||
    jsonb_build_object(
      'fallback_title', p_title,
      'fallback_message', p_message,
      'minute_title', COALESCE(p_metadata->>'minute_title', ''),
      'minute_revision', COALESCE(p_metadata->>'minute_revision', ''),
      'actor_name', COALESCE(p_metadata->>'actor_name', ''),
      'approver_name', COALESCE(p_metadata->>'approver_name', ''),
      'change_reason', COALESCE(p_metadata->>'change_reason', ''),
      'decision_title', COALESCE(p_metadata->>'decision_title', ''),
      'decision_status', COALESCE(p_metadata->>'decision_status', ''),
      'decision_progress', COALESCE(p_metadata->>'decision_progress', ''),
      'decision_owner_name', COALESCE(p_metadata->>'decision_owner_name', ''),
      'decision_due_date', COALESCE(p_metadata->>'decision_due_date', ''),
      'followup_date', COALESCE(p_metadata->>'followup_date', ''),
      'followup_method', COALESCE(p_metadata->>'followup_method', ''),
      'followup_result', COALESCE(p_metadata->>'followup_result', ''),
      'obstacle_title', COALESCE(p_metadata->>'obstacle_title', ''),
      'obstacle_severity', COALESCE(p_metadata->>'obstacle_severity', ''),
      'minute_link', COALESCE(p_metadata->>'minute_link', ''),
      'decision_link', COALESCE(p_metadata->>'decision_link', '')
    );

  -- Build idempotency key
  v_idempotency := COALESCE(p_event_key,
    v_canonical_event || ':' || COALESCE(p_entity_id::text, '') || ':' || p_recipient_user_id::text);

  -- Queue to outbox via central resolver
  PERFORM public.resolve_and_queue_notification(
    v_canonical_event,
    p_recipient_user_id,
    v_audience,
    v_entity_type_resolved,
    p_entity_id,
    p_minute_id,
    p_actor_user_id,
    v_context,
    v_idempotency,
    p_revision_number
  );
END;
$$;
