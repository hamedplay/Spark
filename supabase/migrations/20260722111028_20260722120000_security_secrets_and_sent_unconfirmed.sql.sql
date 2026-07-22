-- ═══════════════════════════════════════════════════════════════════════
-- Security migration: Remove secrets from system_config
-- ═══════════════════════════════════════════════════════════════════════

-- Delete compromised secrets from system_config (values never logged)
DELETE FROM public.system_config
WHERE section = 'security'
AND key IN (
  'send_sms_hook_secret',
  'phone_rate_limit_pepper'
);

-- ═══════════════════════════════════════════════════════════════════════
-- Add sent_unconfirmed status to auth_hook_events
-- ═══════════════════════════════════════════════════════════════════════

-- Drop and recreate constraint with new status
ALTER TABLE public.auth_hook_events
  DROP CONSTRAINT IF EXISTS auth_hook_events_status_check;

ALTER TABLE public.auth_hook_events
  ADD CONSTRAINT auth_hook_events_status_check
  CHECK (status IN ('processing', 'sent', 'sent_unconfirmed', 'failed'));

-- ═══════════════════════════════════════════════════════════════════════
-- Update reserve_auth_hook_event to treat sent_unconfirmed as already_sent
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reserve_auth_hook_event(p_webhook_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.auth_hook_events%ROWTYPE;
BEGIN
  BEGIN
    INSERT INTO public.auth_hook_events (webhook_id, status, locked_until, attempt_count)
    VALUES (p_webhook_id, 'processing', now() + interval '5 minutes', 1)
    ON CONFLICT (webhook_id) DO NOTHING
    RETURNING * INTO v_row;

    IF v_row.webhook_id IS NOT NULL THEN
      RETURN 'reserved';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE;
  END;

  SELECT * INTO v_row FROM public.auth_hook_events WHERE webhook_id = p_webhook_id FOR UPDATE;

  IF v_row.status IN ('sent', 'sent_unconfirmed') THEN
    RETURN 'already_sent';
  END IF;

  IF v_row.status = 'processing' AND v_row.locked_until > now() THEN
    RETURN 'locked';
  END IF;

  UPDATE public.auth_hook_events
  SET status = 'processing',
      locked_until = now() + interval '5 minutes',
      attempt_count = attempt_count + 1,
      updated_at = now()
  WHERE webhook_id = p_webhook_id;

  RETURN 'retry_allowed';
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_auth_hook_event(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_auth_hook_event(text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- New RPC: mark_sent_unconfirmed_auth_hook_event
-- Called when provider succeeded but complete_auth_hook_event failed
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mark_sent_unconfirmed_auth_hook_event(p_webhook_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.auth_hook_events
  SET status = 'sent_unconfirmed', updated_at = now()
  WHERE webhook_id = p_webhook_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_sent_unconfirmed_auth_hook_event(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sent_unconfirmed_auth_hook_event(text) TO service_role;
