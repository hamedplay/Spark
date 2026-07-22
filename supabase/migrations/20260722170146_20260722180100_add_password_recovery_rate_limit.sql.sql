-- ═══════════════════════════════════════════════════════════════════════
-- Add independent rate limit for password recovery (15-minute windows)
-- ═══════════════════════════════════════════════════════════════════════

-- Add purpose column to rate limit table if it doesn't exist
ALTER TABLE public.phone_otp_rate_limit ADD COLUMN IF NOT EXISTS purpose text DEFAULT 'phone_login';

-- Create independent rate limit function for password recovery
DROP FUNCTION IF EXISTS public.consume_phone_password_recovery_rate_limit(text, text);

CREATE OR REPLACE FUNCTION public.consume_phone_password_recovery_rate_limit(
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
  v_window timestamptz := now() - interval '15 minutes';
BEGIN
  -- Lock order: phone first, then IP (always consistent)
  PERFORM pg_advisory_xact_lock(
    hashtextextended('recovery_phone:' || p_phone_hash, 0)
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('recovery_ip:' || p_ip_hash, 0)
  );

  SELECT count(*) INTO v_phone_count
  FROM public.phone_otp_rate_limit
  WHERE phone_hash = p_phone_hash AND purpose = 'phone_password_recovery' AND created_at >= v_window;

  SELECT count(*) INTO v_ip_count
  FROM public.phone_otp_rate_limit
  WHERE ip_hash = p_ip_hash AND purpose = 'phone_password_recovery' AND created_at >= v_window;

  IF v_phone_count >= 3 THEN
    RETURN json_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;

  IF v_ip_count >= 10 THEN
    RETURN json_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;

  INSERT INTO public.phone_otp_rate_limit (phone_hash, ip_hash, purpose)
  VALUES (p_phone_hash, p_ip_hash, 'phone_password_recovery');

  RETURN json_build_object('allowed', true, 'retry_after_seconds', 0);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('allowed', false, 'retry_after_seconds', 900);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_phone_password_recovery_rate_limit(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_phone_password_recovery_rate_limit(text, text) TO authenticated;
