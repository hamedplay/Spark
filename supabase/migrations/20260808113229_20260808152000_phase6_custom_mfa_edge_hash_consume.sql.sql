/* Edge-owned HMAC verification: the MFA pepper stays out of Postgres settings. */
CREATE OR REPLACE FUNCTION public.consume_custom_mfa_challenge_hash(
  p_challenge_id uuid,
  p_otp_hash text,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.custom_mfa_challenges%ROWTYPE;
  v_factor public.custom_mfa_factors%ROWTYPE;
  v_updated int;
BEGIN
  IF v_uid IS NULL OR p_challenge_id IS NULL OR p_otp_hash IS NULL OR p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;
  SELECT * INTO v_challenge FROM public.custom_mfa_challenges
  WHERE id = p_challenge_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_FOUND'); END IF;
  IF v_challenge.session_id <> p_session_id THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_MISMATCH'); END IF;
  IF v_challenge.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_PENDING'); END IF;
  IF v_challenge.expires_at <= now() THEN
    UPDATE public.custom_mfa_challenges SET status = 'expired' WHERE id = p_challenge_id;
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED');
  END IF;
  IF v_challenge.attempt_count >= v_challenge.max_attempts THEN
    UPDATE public.custom_mfa_challenges SET status = 'max_attempts' WHERE id = p_challenge_id;
    RETURN jsonb_build_object('ok', false, 'error', 'MAX_ATTEMPTS_EXCEEDED');
  END IF;
  UPDATE public.custom_mfa_challenges SET attempt_count = attempt_count + 1 WHERE id = p_challenge_id;
  IF v_challenge.otp_hash <> p_otp_hash THEN RETURN jsonb_build_object('ok', false, 'error', 'OTP_INVALID'); END IF;
  UPDATE public.custom_mfa_challenges SET status = 'consumed', consumed_at = now()
  WHERE id = p_challenge_id AND status = 'pending' RETURNING 1 INTO v_updated;
  IF v_updated IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_CONSUMED_RACE'); END IF;
  SELECT * INTO v_factor FROM public.custom_mfa_factors WHERE id = v_challenge.factor_id;
  IF NOT FOUND OR v_factor.factor_status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'error', 'FACTOR_NOT_ACTIVE'); END IF;
  RETURN public.issue_custom_mfa_grant(v_uid, p_session_id, v_challenge.factor_type, 'custom_mfa');
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_custom_mfa_recovery_hash(
  p_code_hash text,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_uid IS NULL OR p_code_hash IS NULL OR p_session_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS'); END IF;
  UPDATE public.custom_mfa_recovery_codes SET used_at = now()
  WHERE user_id = v_uid AND code_hash = p_code_hash AND used_at IS NULL RETURNING 1 INTO v_updated;
  IF v_updated IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'RECOVERY_CODE_INVALID'); END IF;
  RETURN public.issue_custom_mfa_grant(v_uid, p_session_id, 'recovery', 'recovery');
END;
$$;

REVOKE ALL ON FUNCTION public.consume_custom_mfa_challenge_hash(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_custom_mfa_recovery_hash(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_custom_mfa_challenge_hash(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_custom_mfa_recovery_hash(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.verify_custom_mfa_challenge(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_custom_mfa_recovery(text, uuid) FROM PUBLIC, anon, authenticated;
