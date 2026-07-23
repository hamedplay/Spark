-- Create missing rate limit RPC for phone OTP verify
CREATE OR REPLACE FUNCTION public.consume_phone_otp_verify_rate_limit(
  p_phone_hash text,
  p_ip_hash text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_phone_count int;
  v_ip_count int;
  v_phone_limit int := 10;
  v_ip_limit int := 20;
  v_window_seconds int := 900;
BEGIN
  SELECT count(*) INTO v_phone_count
  FROM phone_login_otp_challenges
  WHERE phone_hash = p_phone_hash
    AND created_at > v_now - (v_window_seconds || ' seconds')::interval;

  SELECT count(*) INTO v_ip_count
  FROM phone_login_otp_challenges
  WHERE otp_hash LIKE p_ip_hash || '%'
    AND created_at > v_now - (v_window_seconds || ' seconds')::interval;

  IF v_phone_count >= v_phone_limit OR v_ip_count >= v_ip_limit THEN
    RETURN json_build_object('allowed', false, 'retry_after_seconds', v_window_seconds);
  END IF;

  RETURN json_build_object('allowed', true, 'retry_after_seconds', 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_phone_otp_verify_rate_limit(text, text) FROM anon, authenticated;