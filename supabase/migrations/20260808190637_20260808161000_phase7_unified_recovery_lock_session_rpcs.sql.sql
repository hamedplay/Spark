-- Phase 7: RPCs for unified recovery, progressive lock, session security
-- Reuses public.hmac_with_pepper(text, text) from Phase 6

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Resolve recovery target (anti-enumeration: returns ok=false for not found)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resolve_unified_recovery_target(
  p_identifier_type text,
  p_identifier_value text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_phone text;
  v_identifier_hash text;
BEGIN
  IF p_identifier_type NOT IN ('username','email','phone') OR p_identifier_value IS NULL OR length(trim(p_identifier_value)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  v_identifier_hash := public.hmac_with_pepper(p_identifier_value, 'recovery_identifier');

  IF p_identifier_type = 'username' THEN
    SELECT user_id, email, phone INTO v_user_id, v_email, v_phone
    FROM public.profiles WHERE lower(trim(username)) = lower(trim(p_identifier_value)) AND is_active = true LIMIT 1;
  ELSIF p_identifier_type = 'email' THEN
    SELECT user_id, email, phone INTO v_user_id, v_email, v_phone
    FROM public.profiles WHERE lower(trim(email)) = lower(trim(p_identifier_value)) AND is_active = true LIMIT 1;
  ELSIF p_identifier_type = 'phone' THEN
    SELECT user_id, email, phone INTO v_user_id, v_email, v_phone
    FROM public.profiles WHERE trim(phone) = trim(p_identifier_value) AND is_active = true LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'identifier_hash', v_identifier_hash);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'identifier_hash', v_identifier_hash,
    'has_email', v_email IS NOT NULL AND length(trim(v_email)) > 0,
    'has_phone', v_phone IS NOT NULL AND length(trim(v_phone)) >= 10,
    'email_hint', CASE WHEN v_email IS NOT NULL AND length(trim(v_email)) > 0
      THEN substr(v_email, 1, 2) || '••••@' || split_part(v_email, '@', 2) END,
    'phone_hint', CASE WHEN v_phone IS NOT NULL AND length(trim(v_phone)) >= 10
      THEN substr(v_phone, 1, 4) || '•••' || substr(v_phone, length(v_phone)-1) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_unified_recovery_target(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_unified_recovery_target(text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Verify channel ownership (user-provided email/phone must match profile)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.verify_recovery_channel_ownership(
  p_user_id uuid,
  p_channel text,
  p_channel_value text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_email text;
  v_phone text;
  v_match boolean := false;
  v_target_hash text;
BEGIN
  IF p_user_id IS NULL OR p_channel NOT IN ('email','phone') OR p_channel_value IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  SELECT email, phone INTO v_email, v_phone FROM public.profiles WHERE user_id = p_user_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  v_target_hash := public.hmac_with_pepper(p_channel_value, 'recovery_channel');

  IF p_channel = 'email' AND v_email IS NOT NULL AND lower(trim(v_email)) = lower(trim(p_channel_value)) THEN
    v_match := true;
  ELSIF p_channel = 'phone' AND v_phone IS NOT NULL AND trim(v_phone) = trim(p_channel_value) THEN
    v_match := true;
  END IF;

  IF NOT v_match THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OWNERSHIP_FAILED');
  END IF;

  RETURN jsonb_build_object('ok', true, 'target_hash', v_target_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_recovery_channel_ownership(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_recovery_channel_ownership(uuid, text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Create unified recovery challenge
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_unified_recovery_challenge(
  p_challenge_id uuid,
  p_user_id uuid,
  p_identifier_hash text,
  p_channel text,
  p_channel_target_hash text,
  p_otp_hash text,
  p_expires_at timestamptz,
  p_max_attempts integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF p_challenge_id IS NULL OR p_identifier_hash IS NULL OR p_otp_hash IS NULL OR p_expires_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;
  IF p_channel NOT IN ('email','phone','bale') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CHANNEL');
  END IF;
  IF p_max_attempts < 1 OR p_max_attempts > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MAX_ATTEMPTS');
  END IF;
  IF p_expires_at <= now() OR p_expires_at > now() + interval '1 hour' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_EXPIRY');
  END IF;

  UPDATE public.unified_recovery_challenges SET status = 'EXPIRED', updated_at = now()
  WHERE identifier_hash = p_identifier_hash AND status = 'REQUESTED';

  INSERT INTO public.unified_recovery_challenges (
    id, user_id, identifier_hash, channel, channel_target_hash, otp_hash,
    status, max_attempts, expires_at
  ) VALUES (
    p_challenge_id, p_user_id, p_identifier_hash, p_channel, p_channel_target_hash, p_otp_hash,
    'CODE_SENT', p_max_attempts, p_expires_at
  );

  RETURN jsonb_build_object('ok', true, 'challenge_id', p_challenge_id);
END;
$$;
REVOKE ALL ON FUNCTION public.create_unified_recovery_challenge(uuid, uuid, text, text, text, text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_unified_recovery_challenge(uuid, uuid, text, text, text, text, timestamptz, integer) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Verify unified recovery challenge (atomic, OTP → reset token)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.verify_unified_recovery_challenge(
  p_challenge_id uuid,
  p_otp_hash text,
  p_reset_token_hash text,
  p_reset_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_challenge public.unified_recovery_challenges%ROWTYPE;
  v_updated int;
BEGIN
  IF p_challenge_id IS NULL OR p_otp_hash IS NULL OR p_reset_token_hash IS NULL OR p_reset_expires_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  SELECT * INTO v_challenge FROM public.unified_recovery_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_FOUND'); END IF;

  IF v_challenge.status NOT IN ('CODE_SENT') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_PENDING');
  END IF;

  IF v_challenge.expires_at <= now() THEN
    UPDATE public.unified_recovery_challenges SET status = 'EXPIRED', updated_at = now() WHERE id = p_challenge_id;
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED');
  END IF;

  IF v_challenge.attempt_count >= v_challenge.max_attempts THEN
    UPDATE public.unified_recovery_challenges SET status = 'LOCKED', updated_at = now() WHERE id = p_challenge_id;
    RETURN jsonb_build_object('ok', false, 'error', 'MAX_ATTEMPTS_EXCEEDED');
  END IF;

  UPDATE public.unified_recovery_challenges SET attempt_count = attempt_count + 1, updated_at = now() WHERE id = p_challenge_id;

  IF v_challenge.otp_hash <> p_otp_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OTP_INVALID');
  END IF;

  UPDATE public.unified_recovery_challenges
  SET status = 'RESET_TOKEN_ISSUED', reset_token_hash = p_reset_token_hash,
      reset_expires_at = p_reset_expires_at, verified_at = now(), updated_at = now()
  WHERE id = p_challenge_id AND status = 'CODE_SENT' RETURNING 1 INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_CONSUMED_RACE');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_unified_recovery_challenge(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_unified_recovery_challenge(uuid, text, text, timestamptz) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Claim recovery completion (atomic verified → processing)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.claim_unified_recovery_completion(
  p_challenge_id uuid,
  p_reset_token_hash text,
  p_claim_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_challenge public.unified_recovery_challenges%ROWTYPE;
  v_updated int;
BEGIN
  IF p_challenge_id IS NULL OR p_reset_token_hash IS NULL OR p_claim_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  SELECT * INTO v_challenge FROM public.unified_recovery_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_FOUND'); END IF;

  IF v_challenge.status = 'PROCESSING' AND v_challenge.processing_claim_id = p_claim_id THEN
    RETURN jsonb_build_object('ok', true, 'user_id', v_challenge.user_id, 'idempotent', true);
  END IF;

  IF v_challenge.status <> 'RESET_TOKEN_ISSUED' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_VERIFIED');
  END IF;

  IF v_challenge.reset_token_hash IS NULL OR v_challenge.reset_token_hash <> p_reset_token_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESET_TOKEN_INVALID');
  END IF;

  IF v_challenge.reset_expires_at IS NULL OR v_challenge.reset_expires_at <= now() THEN
    UPDATE public.unified_recovery_challenges SET status = 'EXPIRED', updated_at = now() WHERE id = p_challenge_id;
    RETURN jsonb_build_object('ok', false, 'error', 'RESET_TOKEN_EXPIRED');
  END IF;

  UPDATE public.unified_recovery_challenges
  SET status = 'PROCESSING', processing_claim_id = p_claim_id,
      processing_expires_at = now() + interval '60 seconds', updated_at = now()
  WHERE id = p_challenge_id AND status = 'RESET_TOKEN_ISSUED' RETURNING 1 INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLAIM_RACE');
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', v_challenge.user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_unified_recovery_completion(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_unified_recovery_completion(uuid, text, uuid) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Finalize recovery completion (processing → consumed, increment epoch, revoke grants)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.finalize_unified_recovery_completion(
  p_challenge_id uuid,
  p_claim_id uuid,
  p_success boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_challenge public.unified_recovery_challenges%ROWTYPE;
  v_user_id uuid;
  v_updated int;
BEGIN
  IF p_challenge_id IS NULL OR p_claim_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  SELECT * INTO v_challenge FROM public.unified_recovery_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_FOUND'); END IF;

  IF p_success THEN
    IF v_challenge.status <> 'PROCESSING' OR v_challenge.processing_claim_id IS NULL OR v_challenge.processing_claim_id <> p_claim_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
    END IF;

    UPDATE public.unified_recovery_challenges
    SET status = 'CONSUMED', consumed_at = now(), processing_claim_id = NULL, processing_expires_at = NULL, updated_at = now()
    WHERE id = p_challenge_id AND status = 'PROCESSING' RETURNING 1 INTO v_updated;

    IF v_updated IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONSUME_RACE'); END IF;

    v_user_id := v_challenge.user_id;

    UPDATE public.profiles SET auth_epoch = auth_epoch + 1, locked_until = NULL
    WHERE user_id = v_user_id;

    UPDATE public.custom_mfa_grants SET revoked_at = now()
    WHERE user_id = v_user_id AND revoked_at IS NULL;

    UPDATE public.session_security_grants SET consumed_at = now()
    WHERE user_id = v_user_id AND consumed_at IS NULL;

    UPDATE public.session_security_state SET revoked_at = now(), revoke_reason = 'password_reset'
    WHERE user_id = v_user_id AND revoked_at IS NULL;

    RETURN jsonb_build_object('ok', true, 'user_id', v_user_id);
  ELSE
    UPDATE public.unified_recovery_challenges
    SET status = 'RESET_TOKEN_ISSUED', processing_claim_id = NULL, processing_expires_at = NULL, updated_at = now()
    WHERE id = p_challenge_id AND status = 'PROCESSING' AND processing_claim_id = p_claim_id;
    RETURN jsonb_build_object('ok', true);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_unified_recovery_completion(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_unified_recovery_completion(uuid, uuid, boolean) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Progressive lock: record failure and escalate
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_auth_failure(
  p_user_id uuid,
  p_identifier_hash text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_settings record;
  v_recent_failures integer;
  v_threshold integer;
  v_schedule text[];
  v_current_lock_level integer;
  v_new_lock_level integer;
  v_lock_minutes integer;
  v_locked_until timestamptz;
  v_profile_locked_until timestamptz;
  v_schedule_len integer;
BEGIN
  IF p_user_id IS NULL OR p_identifier_hash IS NULL OR p_ip_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  SELECT progressive_lock_enabled, lock_threshold, progressive_lock_schedule
  INTO v_settings FROM public.auth_security_settings WHERE id = 1 LIMIT 1;

  v_threshold := COALESCE(v_settings.lock_threshold, 5);
  v_schedule := COALESCE(v_settings.progressive_lock_schedule, ARRAY['1','6','12','24','48','72']::text[]);
  v_schedule_len := COALESCE(array_length(v_schedule, 1), 0);

  SELECT locked_until INTO v_profile_locked_until FROM public.profiles WHERE user_id = p_user_id LIMIT 1;
  IF v_profile_locked_until IS NOT NULL AND v_profile_locked_until > now() THEN
    RETURN jsonb_build_object('ok', true, 'locked', true, 'locked_until', v_profile_locked_until, 'rate_limited', false);
  END IF;

  SELECT count(*) INTO v_recent_failures
  FROM public.auth_lock_events
  WHERE user_id = p_user_id AND created_at > now() - interval '24 hours';

  INSERT INTO public.auth_lock_events (user_id, identifier_hash, ip_hash, failure_count, lock_level, locked_until)
  VALUES (p_user_id, p_identifier_hash, p_ip_hash, 1, 0, NULL);

  v_recent_failures := v_recent_failures + 1;

  IF v_recent_failures < v_threshold THEN
    RETURN jsonb_build_object('ok', true, 'locked', false, 'rate_limited', false, 'failures', v_recent_failures);
  END IF;

  v_current_lock_level := 0;
  SELECT COALESCE(max(lock_level), 0) INTO v_current_lock_level
  FROM public.auth_lock_events
  WHERE user_id = p_user_id AND locked_until IS NOT NULL AND locked_until > now() - interval '72 hours';

  v_new_lock_level := LEAST(v_current_lock_level + 1, v_schedule_len);

  IF v_new_lock_level >= v_schedule_len THEN
    UPDATE public.profiles SET account_status = 'LOCKED', locked_until = NULL WHERE user_id = p_user_id;
    UPDATE public.auth_lock_events SET lock_level = v_new_lock_level, locked_until = now() + interval '72 hours'
    WHERE id = (SELECT id FROM public.auth_lock_events WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 1);
    RETURN jsonb_build_object('ok', true, 'locked', true, 'admin_unlock_required', true, 'lock_level', v_new_lock_level);
  END IF;

  v_lock_minutes := (v_schedule[v_new_lock_level])::integer;
  v_locked_until := now() + (v_lock_minutes || ' minutes')::interval;

  UPDATE public.profiles SET locked_until = v_locked_until WHERE user_id = p_user_id;
  UPDATE public.auth_lock_events SET lock_level = v_new_lock_level, locked_until = v_locked_until
  WHERE id = (SELECT id FROM public.auth_lock_events WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 1);

  RETURN jsonb_build_object('ok', true, 'locked', true, 'locked_until', v_locked_until, 'lock_level', v_new_lock_level, 'lock_minutes', v_lock_minutes);
END;
$$;
REVOKE ALL ON FUNCTION public.record_auth_failure(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_auth_failure(uuid, text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Check and clear expired lock
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_account_lock_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_locked_until timestamptz;
  v_account_status text;
BEGIN
  SELECT locked_until, account_status INTO v_locked_until, v_account_status
  FROM public.profiles WHERE user_id = p_user_id LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until <= now() AND v_account_status <> 'LOCKED' THEN
    UPDATE public.profiles SET locked_until = NULL WHERE user_id = p_user_id;
    v_locked_until := NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'locked', v_locked_until IS NOT NULL AND v_locked_until > now(),
    'locked_until', v_locked_until,
    'admin_locked', v_account_status = 'LOCKED'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.check_account_lock_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_account_lock_status(uuid) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Session security: register/touch/revoke
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.register_session_security_state(
  p_session_id uuid,
  p_user_id uuid,
  p_auth_epoch integer,
  p_idle_timeout_minutes integer,
  p_absolute_lifetime_minutes integer,
  p_device_summary text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_idle_expiry timestamptz;
  v_absolute_expiry timestamptz;
  v_max_sessions integer;
  v_active_count integer;
BEGIN
  IF p_session_id IS NULL OR p_user_id IS NULL OR p_auth_epoch IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  v_idle_expiry := now() + (COALESCE(p_idle_timeout_minutes, 480) || ' minutes')::interval;
  v_absolute_expiry := now() + (COALESCE(p_absolute_lifetime_minutes, 1440) || ' minutes')::interval;

  SELECT max_active_sessions INTO v_max_sessions FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  v_max_sessions := COALESCE(v_max_sessions, 5);
  SELECT count(*) INTO v_active_count FROM public.session_security_state
  WHERE user_id = p_user_id AND revoked_at IS NULL AND absolute_expiry_at > now();

  IF v_active_count >= v_max_sessions THEN
    UPDATE public.session_security_state SET revoked_at = now(), revoke_reason = 'max_sessions_exceeded'
    WHERE id = (
      SELECT id FROM public.session_security_state
      WHERE user_id = p_user_id AND revoked_at IS NULL
      ORDER BY created_at ASC LIMIT 1
    );
  END IF;

  INSERT INTO public.session_security_state (
    session_id, user_id, auth_epoch, idle_expiry_at, absolute_expiry_at, device_summary, ip_hash
  ) VALUES (
    p_session_id, p_user_id, p_auth_epoch, v_idle_expiry, v_absolute_expiry, p_device_summary, p_ip_hash
  )
  ON CONFLICT (session_id) DO UPDATE SET
    auth_epoch = EXCLUDED.auth_epoch,
    last_activity_at = now(),
    idle_expiry_at = EXCLUDED.idle_expiry_at,
    absolute_expiry_at = EXCLUDED.absolute_expiry_at,
    device_summary = EXCLUDED.device_summary,
    ip_hash = EXCLUDED.ip_hash,
    revoked_at = NULL,
    revoke_reason = NULL;

  RETURN jsonb_build_object('ok', true, 'idle_expiry_at', v_idle_expiry, 'absolute_expiry_at', v_absolute_expiry);
END;
$$;
REVOKE ALL ON FUNCTION public.register_session_security_state(uuid, uuid, integer, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_session_security_state(uuid, uuid, integer, integer, integer, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.touch_session_security_state(
  p_session_id uuid,
  p_user_id uuid,
  p_auth_epoch integer,
  p_idle_timeout_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_state record;
  v_new_idle timestamptz;
BEGIN
  IF p_session_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  SELECT * INTO v_state FROM public.session_security_state WHERE session_id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND');
  END IF;

  IF v_state.user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_MISMATCH');
  END IF;

  IF v_state.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REVOKED');
  END IF;

  IF v_state.auth_epoch <> p_auth_epoch THEN
    UPDATE public.session_security_state SET revoked_at = now(), revoke_reason = 'epoch_mismatch'
    WHERE session_id = p_session_id;
    RETURN jsonb_build_object('ok', false, 'error', 'EPOCH_MISMATCH');
  END IF;

  IF v_state.absolute_expiry_at <= now() THEN
    UPDATE public.session_security_state SET revoked_at = now(), revoke_reason = 'absolute_timeout'
    WHERE session_id = p_session_id;
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_ABSOLUTE_EXPIRED');
  END IF;

  IF v_state.idle_expiry_at <= now() THEN
    UPDATE public.session_security_state SET revoked_at = now(), revoke_reason = 'idle_timeout'
    WHERE session_id = p_session_id;
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_IDLE_EXPIRED');
  END IF;

  v_new_idle := now() + (COALESCE(p_idle_timeout_minutes, 480) || ' minutes')::interval;
  UPDATE public.session_security_state
  SET last_activity_at = now(), idle_expiry_at = v_new_idle
  WHERE session_id = p_session_id;

  RETURN jsonb_build_object('ok', true, 'idle_expiry_at', v_new_idle, 'absolute_expiry_at', v_state.absolute_expiry_at);
END;
$$;
REVOKE ALL ON FUNCTION public.touch_session_security_state(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_session_security_state(uuid, uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_session_security_state(
  p_session_id uuid,
  p_user_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_updated int;
BEGIN
  IF p_session_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;
  UPDATE public.session_security_state SET revoked_at = now(), revoke_reason = COALESCE(p_reason, 'user_revoke')
  WHERE session_id = p_session_id AND user_id = p_user_id AND revoked_at IS NULL RETURNING 1 INTO v_updated;
  IF v_updated IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_session_security_state(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_session_security_state(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_other_sessions(
  p_user_id uuid,
  p_keep_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_count int;
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS'); END IF;
  UPDATE public.session_security_state SET revoked_at = now(), revoke_reason = 'other_sessions'
  WHERE user_id = p_user_id AND revoked_at IS NULL AND (p_keep_session_id IS NULL OR session_id <> p_keep_session_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'revoked_count', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_other_sessions(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_other_sessions(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_all_sessions(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_count int;
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS'); END IF;
  UPDATE public.session_security_state SET revoked_at = now(), revoke_reason = 'all_sessions'
  WHERE user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'revoked_count', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_all_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_sessions(uuid) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Get my sessions (for session management UI)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_session_security_state()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED'); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'sessions', (
      SELECT jsonb_agg(jsonb_build_object(
        'session_id', session_id,
        'created_at', created_at,
        'last_activity_at', last_activity_at,
        'idle_expiry_at', idle_expiry_at,
        'absolute_expiry_at', absolute_expiry_at,
        'revoked_at', revoked_at,
        'revoke_reason', revoke_reason,
        'device_summary', device_summary,
        'status', CASE
          WHEN revoked_at IS NOT NULL THEN 'revoked'
          WHEN absolute_expiry_at <= now() THEN 'absolute_expired'
          WHEN idle_expiry_at <= now() THEN 'idle_expired'
          ELSE 'active'
        END
      ))
      FROM public.session_security_state
      WHERE user_id = v_uid
      ORDER BY created_at DESC
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_session_security_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_session_security_state() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Unified recovery rate limit
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.consume_unified_recovery_rate_limit(
  p_purpose text,
  p_identifier_hash text,
  p_ip_hash text,
  p_identifier_limit integer,
  p_ip_limit integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_identifier_count integer;
  v_ip_count integer;
  v_retry_after integer;
  v_lock_key bigint;
  v_oldest timestamptz;
BEGIN
  IF p_purpose NOT IN ('recovery_request','recovery_verify','recovery_complete') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PURPOSE');
  END IF;

  v_lock_key := hashtext(COALESCE(p_ip_hash, '') || p_purpose);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT count(*) INTO v_ip_count FROM public.unified_recovery_rate_limit
  WHERE ip_hash = p_ip_hash AND purpose = p_purpose AND created_at > now() - (p_window_seconds || ' seconds')::interval;

  IF v_ip_count >= p_ip_limit THEN
    SELECT min(created_at) INTO v_oldest FROM public.unified_recovery_rate_limit
    WHERE ip_hash = p_ip_hash AND purpose = p_purpose AND created_at > now() - (p_window_seconds || ' seconds')::interval;
    v_retry_after := GREATEST(p_window_seconds - EXTRACT(EPOCH FROM (now() - v_oldest))::integer, 1);
    RETURN jsonb_build_object('ok', true, 'allowed', false, 'retry_after_seconds', v_retry_after);
  END IF;

  IF p_identifier_hash IS NOT NULL THEN
    SELECT count(*) INTO v_identifier_count FROM public.unified_recovery_rate_limit
    WHERE identifier_hash = p_identifier_hash AND purpose = p_purpose AND created_at > now() - (p_window_seconds || ' seconds')::interval;

    IF v_identifier_count >= p_identifier_limit THEN
      SELECT min(created_at) INTO v_oldest FROM public.unified_recovery_rate_limit
      WHERE identifier_hash = p_identifier_hash AND purpose = p_purpose AND created_at > now() - (p_window_seconds || ' seconds')::interval;
      v_retry_after := GREATEST(p_window_seconds - EXTRACT(EPOCH FROM (now() - v_oldest))::integer, 1);
      RETURN jsonb_build_object('ok', true, 'allowed', false, 'retry_after_seconds', v_retry_after);
    END IF;
  END IF;

  INSERT INTO public.unified_recovery_rate_limit (purpose, identifier_hash, ip_hash)
  VALUES (p_purpose, p_identifier_hash, p_ip_hash);

  RETURN jsonb_build_object('ok', true, 'allowed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_unified_recovery_rate_limit(text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_unified_recovery_rate_limit(text, text, text, integer, integer, integer) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. Admin unlock
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_unlock_account(
  p_user_id uuid,
  p_admin_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_updated int;
BEGIN
  IF p_user_id IS NULL OR p_admin_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_admin_user_id AND is_admin = true AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  END IF;
  UPDATE public.profiles SET locked_until = NULL, account_status = 'ACTIVE'
  WHERE user_id = p_user_id AND account_status = 'LOCKED'
  AND user_id <> p_admin_user_id RETURNING 1 INTO v_updated;
  IF v_updated IS NULL THEN
    UPDATE public.profiles SET locked_until = NULL
    WHERE user_id = p_user_id AND locked_until IS NOT NULL RETURNING 1 INTO v_updated;
    IF v_updated IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_LOCKED'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unlock_account(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlock_account(uuid, uuid) TO service_role;
