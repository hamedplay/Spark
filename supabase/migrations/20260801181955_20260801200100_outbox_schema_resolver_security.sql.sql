/*
# Outbox schema additions + central notification resolver + security fixes

1. Schema Changes
- Add columns to notification_outbox: category, entity_type, entity_id, minute_id,
  actor_user_id, idempotency_key, next_attempt_at, sms_status, sms_sent_at
- Add unique index on idempotency_key for deduplication
- Add index on status, next_attempt_at for worker polling

2. New Function
- resolve_and_queue_notification(...) — central resolver that:
  a) validates event_key against notification_event_registry
  b) checks notification_enabled and is_active
  c) resolves group rules for recipient (multi-group OR logic, default enabled)
  d) looks up notification_template by category+event_type+audience, falls back to audience='all'
  e) renders placeholders using {{key}} syntax
  f) inserts into notification_outbox (not directly into notifications)
  g) returns jsonb with queued status

3. Security Fixes
- notification_outbox: restrict INSERT/UPDATE to service_role only (SECURITY DEFINER RPCs insert)
- notifications: remove "Users can insert own notifications" policy
- minutes_decision_reminders: remove UPDATE/DELETE/INSERT policies, keep SELECT only
- claim_due_minutes_decision_reminders: REVOKE from anon, authenticated; GRANT to service_role only
- manage_minutes_decision: REVOKE from PUBLIC, anon; keep authenticated
- get_my_minutes_hub_counts: REVOKE from PUBLIC, anon; keep authenticated

4. Notes
- All operations are additive (ALTER TABLE ADD COLUMN IF NOT EXISTS)
- No existing data modified or deleted
- No existing migrations changed
*/

-- ── 1. Outbox schema additions ──────────────────────────────────────────────

ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS minute_id uuid;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS actor_user_id uuid;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz DEFAULT now();
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS sms_status text DEFAULT 'not_requested';
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS sms_sent_at timestamptz;

-- Unique index on idempotency_key for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_idempotency_key_key
  ON public.notification_outbox (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Index for worker polling: status + next_attempt_at
CREATE INDEX IF NOT EXISTS notification_outbox_status_next_attempt_idx
  ON public.notification_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

-- ── 2. Outbox RLS: restrict to service_role ──────────────────────────────────
-- Only SECURITY DEFINER RPCs and service_role should insert/update outbox.
-- Users should not directly manipulate outbox rows.

DROP POLICY IF EXISTS "authenticated_insert_outbox" ON public.notification_outbox;
DROP POLICY IF EXISTS "authenticated_update_outbox" ON public.notification_outbox;
DROP POLICY IF EXISTS "authenticated_select_outbox" ON public.notification_outbox;

-- No policies = deny by default for authenticated/anon. service_role bypasses RLS.

-- ── 3. Notifications RLS: remove direct user INSERT ────────────────────────
-- Users should not be able to create fake notifications for themselves.
-- Only backend RPCs (SECURITY DEFINER) and service_role insert notifications.

DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;

-- ── 4. Reminder RLS: restrict to SELECT only for users ──────────────────────
-- Users can see their reminders but cannot modify status, dates, or processing state.

DROP POLICY IF EXISTS "delete_own_reminders" ON public.minutes_decision_reminders;
DROP POLICY IF EXISTS "insert_own_reminders" ON public.minutes_decision_reminders;
DROP POLICY IF EXISTS "update_own_reminders" ON public.minutes_decision_reminders;

-- Keep SELECT only
DROP POLICY IF EXISTS "select_own_reminders" ON public.minutes_decision_reminders;
CREATE POLICY "select_own_reminders"
  ON public.minutes_decision_reminders FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_user_id OR auth.uid() = created_by_user_id);

-- ── 5. Function grants ──────────────────────────────────────────────────────

-- claim_due_minutes_decision_reminders: service_role ONLY
REVOKE ALL ON FUNCTION public.claim_due_minutes_decision_reminders(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_minutes_decision_reminders(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_due_minutes_decision_reminders(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_minutes_decision_reminders(integer) TO service_role;

-- manage_minutes_decision: authenticated + service_role only
REVOKE ALL ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_minutes_decision(uuid, timestamptz, text, text, text, text, jsonb, uuid, timestamptz) TO service_role;

-- get_my_minutes_hub_counts: authenticated + service_role only
REVOKE ALL ON FUNCTION public.get_my_minutes_hub_counts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_minutes_hub_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_minutes_hub_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_minutes_hub_counts() TO service_role;

-- ── 6. Central notification resolver ────────────────────────────────────────

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
    -- fallback to 'all' if available
    IF 'all' = ANY(v_registry.allowed_audiences) THEN
      p_audience := 'all';
    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'AUDIENCE_NOT_ALLOWED');
    END IF;
  END IF;

  -- 4. Check group rules (multi-group OR logic)
  -- Get user's group IDs
  SELECT array_agg(group_id) INTO v_user_group_ids
  FROM public.user_group_members
  WHERE user_id = p_recipient_user_id;

  IF v_user_group_ids IS NOT NULL AND array_length(v_user_group_ids, 1) > 0 THEN
    -- Check rules for this event_key across all user's groups
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

    -- If rules exist but none enabled, block notification
    IF v_any_rule_exists AND NOT v_any_enabled THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'GROUP_RULE_DISABLED');
    END IF;
    -- If no rules exist, default is enabled (v_group_allowed stays true)
  END IF;
  -- If user has no groups, default is enabled

  -- 5. Lookup notification template (exact audience, fallback to 'all')
  SELECT id, title, body INTO v_template
  FROM public.notification_templates
  WHERE category = v_registry.category
    AND event_type = p_event_key
    AND audience = p_audience
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    -- Fallback to audience='all'
    SELECT id, title, body INTO v_template
    FROM public.notification_templates
    WHERE category = v_registry.category
      AND event_type = p_event_key
      AND audience = 'all'
      AND is_active = true
    LIMIT 1;
  END IF;

  -- 6. Render placeholders or use fallback
  IF FOUND THEN
    v_title := v_template.title;
    v_message := v_template.body;

    -- Replace {{placeholder}} with context values
    IF p_context IS NOT NULL THEN
      FOR v_key, v_value IN SELECT key, value FROM jsonb_each_text(p_context) LOOP
        v_title := replace(v_title, '{{' || v_key || '}}', COALESCE(v_value, ''));
        v_message := replace(v_message, '{{' || v_key || '}}', COALESCE(v_value, ''));
      END LOOP;
    END IF;

    -- Remove any remaining unresolved {{...}} placeholders
    v_title := regexp_replace(v_title, '\{\{[^}]+\}\}', '', 'g');
    v_message := regexp_replace(v_message, '\{\{[^}]+\}\}', '', 'g');
  ELSE
    -- No template found — use context fallback if provided
    v_title := COALESCE(p_context->>'fallback_title', p_event_key);
    v_message := COALESCE(p_context->>'fallback_message', p_event_key);
  END IF;

  -- 7. Build idempotency key
  v_idempotency := COALESCE(p_idempotency_key,
    p_event_key || ':' || COALESCE(p_entity_id::text, '') || ':' || p_recipient_user_id::text);

  -- 8. Insert into notification_outbox (idempotent via unique index)
  BEGIN
    INSERT INTO public.notification_outbox (
      event_key, category, entity_type, entity_id, minute_id,
      actor_user_id, recipient_id, channel, event_type, audience,
      payload, idempotency_key, status, next_attempt_at
    ) VALUES (
      p_event_key, v_registry.category, COALESCE(p_entity_type, v_registry.entity_type),
      p_entity_id, p_minute_id, p_actor_user_id, p_recipient_user_id,
      'in_app', p_event_key, p_audience,
      jsonb_build_object(
        'title', v_title,
        'message', v_message,
        'context', COALESCE(p_context, '{}'::jsonb),
        'template_id', v_template.id,
        'revision_number', p_revision_number,
        'sms_supported', v_registry.sms_supported
      ),
      v_idempotency, 'pending', now()
    )
    RETURNING id INTO v_outbox_id;

    RETURN jsonb_build_object('ok', true, 'queued', true, 'outbox_id', v_outbox_id);
  EXCEPTION WHEN unique_violation THEN
    -- Duplicate — already queued
    RETURN jsonb_build_object('ok', true, 'queued', false, 'reason', 'DUPLICATE');
  END;
END;
$$;

-- Resolver is called by SECURITY DEFINER RPCs, not directly by users
REVOKE ALL ON FUNCTION public.resolve_and_queue_notification(text, uuid, text, text, uuid, uuid, uuid, jsonb, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_and_queue_notification(text, uuid, text, text, uuid, uuid, uuid, jsonb, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_and_queue_notification(text, uuid, text, text, uuid, uuid, uuid, jsonb, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_and_queue_notification(text, uuid, text, text, uuid, uuid, uuid, jsonb, text, integer) TO service_role;
