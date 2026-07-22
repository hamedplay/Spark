-- ═══════════════════════════════════════════════════════════════════════
-- auth_hook_events — Atomic idempotency table for auth-send-sms-hook
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.auth_hook_events (
  webhook_id       text PRIMARY KEY,
  status           text NOT NULL DEFAULT 'processing'
                   CHECK (status IN ('processing', 'sent', 'failed')),
  locked_until     timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  attempt_count    integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  last_error_code  text
);

ALTER TABLE public.auth_hook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_hook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.auth_hook_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_auth_hook_events_expires_at
  ON public.auth_hook_events (expires_at);

-- ── Atomic reservation RPC ──────────────────────────────────────────────
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

  IF v_row.status = 'sent' THEN
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

-- ── Mark as sent ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_auth_hook_event(p_webhook_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.auth_hook_events
  SET status = 'sent', updated_at = now(), last_error_code = NULL
  WHERE webhook_id = p_webhook_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_auth_hook_event(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_auth_hook_event(text) TO service_role;

-- ── Mark as failed ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fail_auth_hook_event(
  p_webhook_id text,
  p_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.auth_hook_events
  SET status = 'failed', updated_at = now(), last_error_code = p_error_code
  WHERE webhook_id = p_webhook_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_auth_hook_event(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_auth_hook_event(text, text) TO service_role;

-- ── Cleanup expired rows ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_auth_hook_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.auth_hook_events WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_auth_hook_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_auth_hook_events() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- phone_otp_rate_limit — Atomic rate limiting with advisory locks
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.phone_otp_rate_limit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash  text NOT NULL,
  ip_hash     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_otp_rate_limit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_otp_rate_limit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.phone_otp_rate_limit TO service_role;

CREATE INDEX IF NOT EXISTS idx_phone_otp_rl_phone_hash
  ON public.phone_otp_rate_limit (phone_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_phone_otp_rl_ip_hash
  ON public.phone_otp_rate_limit (ip_hash, created_at);

-- ── Atomic consume RPC with advisory locks ──────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_phone_otp_rate_limit(
  p_phone_hash text,
  p_ip_hash text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone_count integer;
  v_ip_count integer;
  v_window timestamptz := now() - interval '60 seconds';
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('phone:' || p_phone_hash, 0)
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ip:' || p_ip_hash, 0)
  );

  SELECT count(*) INTO v_phone_count
  FROM public.phone_otp_rate_limit
  WHERE phone_hash = p_phone_hash AND created_at >= v_window;

  SELECT count(*) INTO v_ip_count
  FROM public.phone_otp_rate_limit
  WHERE ip_hash = p_ip_hash AND created_at >= v_window;

  IF v_phone_count >= 3 THEN
    RETURN json_build_object('allowed', false, 'retry_after_seconds', 60);
  END IF;

  IF v_ip_count >= 10 THEN
    RETURN json_build_object('allowed', false, 'retry_after_seconds', 60);
  END IF;

  INSERT INTO public.phone_otp_rate_limit (phone_hash, ip_hash)
  VALUES (p_phone_hash, p_ip_hash);

  RETURN json_build_object('allowed', true, 'retry_after_seconds', 0);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('allowed', false, 'retry_after_seconds', 60);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_phone_otp_rate_limit(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_phone_otp_rate_limit(text, text) TO service_role;

-- ── Cleanup old rows ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_phone_otp_rate_limit()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.phone_otp_rate_limit
  WHERE created_at < (now() - interval '10 minutes');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_phone_otp_rate_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_phone_otp_rate_limit() TO service_role;
