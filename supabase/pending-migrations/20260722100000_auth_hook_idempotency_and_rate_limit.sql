-- ═══════════════════════════════════════════════════════════════════════
-- auth_hook_events — Idempotency table for auth-send-sms-hook
-- PREPARED ONLY — DO NOT APPLY YET
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.auth_hook_events (
  webhook_id   text PRIMARY KEY,
  event_type   text NOT NULL DEFAULT 'send_sms',
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '1 hour')
);

ALTER TABLE public.auth_hook_events ENABLE ROW LEVEL SECURITY;

-- Service role only — no anon/authenticated access
REVOKE ALL ON public.auth_hook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.auth_hook_events TO service_role;

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_auth_hook_events_expires_at
  ON public.auth_hook_events (expires_at);

-- Cleanup function: deletes expired rows
CREATE OR REPLACE FUNCTION public.cleanup_auth_hook_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.auth_hook_events
  WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_auth_hook_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_auth_hook_events() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- phone_otp_rate_limit — Rate limiting for request-phone-login-otp
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.phone_otp_rate_limit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash  text NOT NULL,
  ip_address  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_otp_rate_limit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.phone_otp_rate_limit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.phone_otp_rate_limit TO service_role;

CREATE INDEX IF NOT EXISTS idx_phone_otp_rl_phone_hash
  ON public.phone_otp_rate_limit (phone_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_phone_otp_rl_ip
  ON public.phone_otp_rate_limit (ip_address, created_at);

-- Auto-cleanup: rows older than 10 minutes are safe to delete
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
