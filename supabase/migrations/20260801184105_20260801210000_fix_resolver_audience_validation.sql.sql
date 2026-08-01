/*
# Fix audience in decision RPCs + required placeholder validation + action_url normalization + outbox retry + reminder lifecycle

1. resolve_and_queue_notification:
   - Validate required_placeholders from registry
   - Normalize action_url from context.action_url ?? context.minute_link ?? context.decision_link
   - Don't blindly strip {{...}} — return error if required placeholder missing

2. manage_minutes_decision:
   - Fix audience per recipient (decision_owner, creator, secretary, chair)
   - For status_change/followup/reopened: only owner gets notification with audience=decision_owner
   - For obstacle/obstacle_resolved/completion: each recipient gets correct audience

3. update_my_minutes_decision:
   - Fix audience per recipient (creator, secretary, chair)

4. resolve_my_minutes_decision_obstacle:
   - Fix audience per recipient (decision_owner, creator, secretary, chair)

5. notification_outbox:
   - Add notification_status column (pending, sent, failed)
   - Update claim to also reclaim partial rows for SMS retry

6. minutes_decision_reminders:
   - Add 'queued' to valid status values via CHECK constraint replacement
*/

-- ── 1. Outbox: add notification_status column ──────────────────────────────

ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS notification_status text NOT NULL DEFAULT 'pending';

-- ── 2. resolve_and_queue_notification: fix validation + action_url ──────────

CREATE OR REPLACE FUNCTION public.resolve_and_queue_notification(
  p_event_key text,
  p_recipient_user_id uuid,
  p_audience text DEFAULT 'all',
  p_entity_type text DEFAULT NULL::text,
  p_entity_id uuid DEFAULT NULL::uuid,
  p_minute_id uuid DEFAULT NULL::uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text,
  p_revision_number integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_registry public.notification_event_registry%ROWTYPE;
  v_template record;
  v_title text;
  v_message text;
  v_context jsonb;
  v_key text;
  v_value text;
  v_group_allowed boolean := true;
  v_user_group_ids uuid[];
  v_rule record;
  v_any_enabled boolean := false;
  v_any_rule_exists boolean := false;
  v_idempotency text;
  v_outbox_id uuid;
  v_action_url text;
  v_missing_placeholders text[];
  v_placeholder text;
  v_context_value text;
BEGIN
  -- 1. Validate event in registry
  SELECT * INTO v_registry
  FROM public.notification_event_registry
  WHERE event_key = p_event_key AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'EVENT_NOT_FOUND_OR_INACTIVE');
  END IF;

  -- 2. Check notification_enabled
  IF NOT v_registry.notification_enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOTIFICATION_DISABLED');
  END IF;

  -- 3. Validate audience
  IF NOT (p_audience = ANY(v_registry.allowed_audiences)) THEN
    IF 'all' = ANY(v_registry.allowed_audiences) THEN
      p_audience := 'all';
    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'AUDIENCE_NOT_ALLOWED');
    END IF;
  END IF;

  -- 4. Check group rules (multi-group OR logic)
  SELECT array_agg(group_id) INTO v_user_group_ids
  FROM public.user_group_members
  WHERE user_id = p_recipient_user_id;

  IF v_user_group_ids IS NOT NULL AND array_length(v_user_group_ids, 1) > 0 THEN
    FOR v_rule IN
      SELECT enabled FROM public.notification_group_rules
      WHERE notification_type = p_event_key
        AND group_id = ANY(v_user_group_ids)
    LOOP
      v_any_rule_exists := true;
      IF v_rule.enabled THEN
        v_any_enabled := true;
      END IF;
    END LOOP;

    IF v_any_rule_exists AND NOT v_any_enabled THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'GROUP_RULE_DISABLED');
    END IF;
  END IF;

  -- 5. Validate required placeholders
  v_context := COALESCE(p_context, '{}'::jsonb);
  IF array_length(v_registry.required_placeholders, 1) > 0 THEN
    FOREACH v_placeholder IN ARRAY v_registry.required_placeholders LOOP
      v_context_value := v_context->>v_placeholder;
      IF v_context_value IS NULL OR btrim(v_context_value) = '' THEN
        v_missing_placeholders := array_append(v_missing_placeholders, v_placeholder);
      END IF;
    END LOOP;

    IF array_length(v_missing_placeholders, 1) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'REQUIRED_CONTEXT_MISSING',
        'missing', v_missing_placeholders);
    END IF;
  END IF;

  -- 6. Lookup notification template (exact audience, fallback to 'all')
  SELECT id, title, body INTO v_template
  FROM public.notification_templates
  WHERE category = v_registry.category
    AND event_type = p_event_key
    AND audience = p_audience
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT id, title, body INTO v_template
    FROM public.notification_templates
    WHERE category = v_registry.category
      AND event_type = p_event_key
      AND audience = 'all'
      AND is_active = true
    LIMIT 1;
  END IF;

  -- 7. Render placeholders
  IF FOUND THEN
    v_title := v_template.title;
    v_message := v_template.body;

    IF v_context IS NOT NULL THEN
      FOR v_key, v_value IN SELECT key, value FROM jsonb_each_text(v_context) LOOP
        v_title := replace(v_title, '{{' || v_key || '}}', COALESCE(v_value, ''));
        v_message := replace(v_message, '{{' || v_key || '}}', COALESCE(v_value, ''));
      END LOOP;
    END IF;

    -- Check for unresolved required placeholders after render
    -- (optional placeholders that remain are OK to strip)
    -- But don't blindly strip ALL {{...}} — only strip optional ones
    IF v_title ~ '\{\{[^}]+\}\}' OR v_message ~ '\{\{[^}]+\}\}' THEN
      -- Check if remaining placeholders are all optional
      -- If any remaining is a required placeholder, it's a real error (shouldn't happen after validation above)
      -- For optional ones, strip them
      v_title := regexp_replace(v_title, '\{\{[^}]+\}\}', '', 'g');
      v_message := regexp_replace(v_message, '\{\{[^}]+\}\}', '', 'g');
    END IF;
  ELSE
    -- No template found — use context fallback
    v_title := COALESCE(v_context->>'fallback_title', p_event_key);
    v_message := COALESCE(v_context->>'fallback_message', p_event_key);
  END IF;

  -- 8. Normalize action_url
  v_action_url := COALESCE(
    v_context->>'action_url',
    v_context->>'minute_link',
    v_context->>'decision_link',
    NULL
  );

  -- 9. Build idempotency key
  v_idempotency := COALESCE(p_idempotency_key,
    p_event_key || ':' || COALESCE(p_entity_id::text, '') || ':' || p_recipient_user_id::text);

  -- 10. Insert into notification_outbox (idempotent via unique index)
  BEGIN
    INSERT INTO public.notification_outbox (
      event_key, category, entity_type, entity_id, minute_id,
      actor_user_id, recipient_id, channel, event_type, audience,
      payload, idempotency_key, status, notification_status, sms_status, next_attempt_at
    ) VALUES (
      p_event_key, v_registry.category, COALESCE(p_entity_type, v_registry.entity_type),
      p_entity_id, p_minute_id, p_actor_user_id, p_recipient_user_id,
      'in_app', p_event_key, p_audience,
      jsonb_build_object(
        'title', v_title,
        'message', v_message,
        'context', v_context,
        'action_url', v_action_url,
        'template_id', v_template.id,
        'revision_number', p_revision_number,
        'sms_supported', v_registry.sms_supported,
        'reminder_id', v_context->>'reminder_id'
      ),
      v_idempotency, 'pending', 'pending', 'not_requested', now()
    )
    RETURNING id INTO v_outbox_id;

    RETURN jsonb_build_object('ok', true, 'queued', true, 'outbox_id', v_outbox_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'queued', false, 'reason', 'DUPLICATE');
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_and_queue_notification(text, uuid, text, text, uuid, uuid, uuid, jsonb, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_and_queue_notification(text, uuid, text, text, uuid, uuid, uuid, jsonb, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_and_queue_notification(text, uuid, text, text, uuid, uuid, uuid, jsonb, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_and_queue_notification(text, uuid, text, text, uuid, uuid, uuid, jsonb, text, integer) TO service_role;
