/* Service-only RPCs bind every operation to the user authenticated by the Edge Function. */
CREATE OR REPLACE FUNCTION public.create_custom_mfa_challenge_service(
  p_user_id uuid,
  p_factor_type text,
  p_session_id uuid,
  p_otp_hash text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_factor public.custom_mfa_factors%ROWTYPE;
  v_settings record;
  v_challenge_id uuid;
  v_expires_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_otp_hash IS NULL OR p_factor_type NOT IN ('sms','bale','email') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;
  SELECT * INTO v_factor FROM public.custom_mfa_factors
  WHERE user_id = p_user_id AND factor_type = p_factor_type AND factor_status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'FACTOR_NOT_ACTIVE'); END IF;
  IF p_factor_type = 'sms' AND v_factor.phone_hash IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SMS_FACTOR_NO_PHONE'); END IF;
  SELECT custom_mfa_challenge_ttl_seconds, custom_mfa_max_resends, custom_mfa_max_attempts
  INTO v_settings FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  v_expires_at := now() + (COALESCE(v_settings.custom_mfa_challenge_ttl_seconds, 300) || ' seconds')::interval;
  UPDATE public.custom_mfa_challenges SET status = 'expired'
  WHERE user_id = p_user_id AND factor_id = v_factor.id AND status = 'pending';
  INSERT INTO public.custom_mfa_challenges (user_id, factor_id, factor_type, otp_hash, expires_at, session_id, max_attempts, max_resends)
  VALUES (p_user_id, v_factor.id, p_factor_type, p_otp_hash, v_expires_at, p_session_id,
    COALESCE(v_settings.custom_mfa_max_attempts, 5), COALESCE(v_settings.custom_mfa_max_resends, 3))
  RETURNING id INTO v_challenge_id;
  RETURN jsonb_build_object('ok', true, 'challenge_id', v_challenge_id, 'expires_at', v_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_custom_mfa_challenge_service(
  p_user_id uuid,
  p_challenge_id uuid,
  p_otp_hash text,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_challenge public.custom_mfa_challenges%ROWTYPE;
  v_factor public.custom_mfa_factors%ROWTYPE;
  v_updated int;
BEGIN
  IF p_user_id IS NULL OR p_challenge_id IS NULL OR p_otp_hash IS NULL OR p_session_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS'); END IF;
  SELECT * INTO v_challenge FROM public.custom_mfa_challenges WHERE id = p_challenge_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_FOUND'); END IF;
  IF v_challenge.session_id <> p_session_id THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_MISMATCH'); END IF;
  IF v_challenge.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_PENDING'); END IF;
  IF v_challenge.expires_at <= now() THEN UPDATE public.custom_mfa_challenges SET status = 'expired' WHERE id = p_challenge_id; RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED'); END IF;
  IF v_challenge.attempt_count >= v_challenge.max_attempts THEN UPDATE public.custom_mfa_challenges SET status = 'max_attempts' WHERE id = p_challenge_id; RETURN jsonb_build_object('ok', false, 'error', 'MAX_ATTEMPTS_EXCEEDED'); END IF;
  UPDATE public.custom_mfa_challenges SET attempt_count = attempt_count + 1 WHERE id = p_challenge_id;
  IF v_challenge.otp_hash <> p_otp_hash THEN RETURN jsonb_build_object('ok', false, 'error', 'OTP_INVALID'); END IF;
  UPDATE public.custom_mfa_challenges SET status = 'consumed', consumed_at = now() WHERE id = p_challenge_id AND status = 'pending' RETURNING 1 INTO v_updated;
  IF v_updated IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_CONSUMED_RACE'); END IF;
  SELECT * INTO v_factor FROM public.custom_mfa_factors WHERE id = v_challenge.factor_id;
  IF NOT FOUND OR v_factor.factor_status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'error', 'FACTOR_NOT_ACTIVE'); END IF;
  RETURN public.issue_custom_mfa_grant(p_user_id, p_session_id, v_challenge.factor_type, 'custom_mfa');
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_custom_mfa_recovery_service(
  p_user_id uuid,
  p_code_hash text,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_updated int;
BEGIN
  IF p_user_id IS NULL OR p_code_hash IS NULL OR p_session_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS'); END IF;
  UPDATE public.custom_mfa_recovery_codes SET used_at = now() WHERE user_id = p_user_id AND code_hash = p_code_hash AND used_at IS NULL RETURNING 1 INTO v_updated;
  IF v_updated IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'RECOVERY_CODE_INVALID'); END IF;
  RETURN public.issue_custom_mfa_grant(p_user_id, p_session_id, 'recovery', 'recovery');
END;
$$;

REVOKE ALL ON FUNCTION public.create_custom_mfa_challenge_service(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_custom_mfa_challenge_service(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_custom_mfa_recovery_service(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_custom_mfa_challenge_service(uuid, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_custom_mfa_challenge_service(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_custom_mfa_recovery_service(uuid, text, uuid) TO service_role;
