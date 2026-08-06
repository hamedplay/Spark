-- Phase 5E-C1 Fix: Reliable SELECT FOUND Detection
-- Replaces the RPC with the same signature/logic but uses FOUND instead of IS NOT NULL for record detection.

CREATE OR REPLACE FUNCTION public.create_phone_otp_login_challenge_v2(
  p_challenge_id uuid,
  p_user_id uuid,
  p_phone_hash text,
  p_otp_hash text,
  p_ip_hash text,
  p_expires_at timestamptz,
  p_resend_available_at timestamptz,
  p_request_id uuid,
  p_max_attempts integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_now timestamptz;
  v_user_exists boolean;
  v_existing record;
  v_existing_found boolean;
  v_last_active record;
  v_last_active_found boolean;
  v_retry_after integer;
  v_request_lock_key bigint;
  v_phone_lock_key bigint;
BEGIN
  v_now := clock_timestamp();

  -- Input validation (fail-closed for NULL)
  IF p_challenge_id IS NULL OR p_user_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHALLENGE_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  IF p_phone_hash IS NULL OR p_phone_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_CHALLENGE_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  IF p_otp_hash IS NULL OR p_otp_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_CHALLENGE_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  IF p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_CHALLENGE_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  IF p_max_attempts IS NULL OR p_max_attempts < 3 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'INVALID_CHALLENGE_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= v_now OR p_expires_at > v_now + make_interval(secs => 300) THEN
    RAISE EXCEPTION 'INVALID_CHALLENGE_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  IF p_resend_available_at IS NULL
     OR p_resend_available_at < v_now
     OR p_resend_available_at > p_expires_at
     OR p_resend_available_at > v_now + make_interval(secs => 300) THEN
    RAISE EXCEPTION 'INVALID_CHALLENGE_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  -- Verify user exists in auth.users
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = p_user_id) INTO v_user_exists;
  IF NOT v_user_exists THEN
    RAISE EXCEPTION 'INVALID_CHALLENGE_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  -- Advisory lock keys with distinct domain prefixes
  v_request_lock_key := pg_catalog.hashtextextended('phone-otp-login-challenge-v2|request|' || p_request_id::text, 0);
  v_phone_lock_key := pg_catalog.hashtextextended('phone-otp-login-challenge-v2|phone|' || p_phone_hash, 0);

  -- Acquire request lock first, then phone lock (fixed order)
  PERFORM pg_catalog.pg_advisory_xact_lock(v_request_lock_key);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_phone_lock_key);

  -- Idempotency check: look for existing record with same request_id
  SELECT *
    INTO v_existing
    FROM private.phone_otp_login_challenges_v2
    WHERE request_id = p_request_id
    FOR UPDATE;

  v_existing_found := FOUND;

  IF v_existing_found THEN
    IF v_existing.id IS DISTINCT FROM p_challenge_id
       OR v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.phone_hash IS DISTINCT FROM p_phone_hash
       OR v_existing.otp_hash IS DISTINCT FROM p_otp_hash
       OR v_existing.ip_hash IS DISTINCT FROM p_ip_hash
       OR v_existing.expires_at IS DISTINCT FROM p_expires_at
       OR v_existing.resend_available_at IS DISTINCT FROM p_resend_available_at
       OR v_existing.max_attempts IS DISTINCT FROM p_max_attempts
    THEN
      RAISE EXCEPTION 'REQUEST_ID_REUSE_MISMATCH' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'created', false,
      'idempotent', true,
      'challenge_id', v_existing.id,
      'error_code', null,
      'retry_after_seconds', 0
    );
  END IF;

  -- Resend Gate: check last pending or processing challenge for same phone
  SELECT *
    INTO v_last_active
    FROM private.phone_otp_login_challenges_v2
    WHERE phone_hash = p_phone_hash
      AND status IN ('pending', 'processing')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

  v_last_active_found := FOUND;

  IF v_last_active_found
     AND v_last_active.resend_available_at > v_now
  THEN
    v_retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_last_active.resend_available_at - v_now)))::integer);
    RETURN jsonb_build_object(
      'created', false,
      'idempotent', false,
      'challenge_id', null,
      'error_code', 'RESEND_NOT_READY',
      'retry_after_seconds', v_retry_after
    );
  END IF;

  -- Supersede pending challenges for same phone
  UPDATE private.phone_otp_login_challenges_v2
    SET status = 'superseded',
        claim_id = null,
        claim_expires_at = null,
        updated_at = v_now
    WHERE phone_hash = p_phone_hash
      AND status = 'pending';

  -- Supersede processing challenges only if claim has expired
  UPDATE private.phone_otp_login_challenges_v2
    SET status = 'superseded',
        claim_id = null,
        claim_expires_at = null,
        updated_at = v_now
    WHERE phone_hash = p_phone_hash
      AND status = 'processing'
      AND claim_expires_at <= v_now;

  -- Insert exactly one new challenge
  INSERT INTO private.phone_otp_login_challenges_v2 (
    id,
    user_id,
    phone_hash,
    otp_hash,
    ip_hash,
    status,
    attempt_count,
    max_attempts,
    expires_at,
    resend_available_at,
    request_id,
    claim_id,
    claim_expires_at,
    delivery_status,
    consumed_at,
    created_at,
    updated_at
  )
  VALUES (
    p_challenge_id,
    p_user_id,
    p_phone_hash,
    p_otp_hash,
    p_ip_hash,
    'pending',
    0,
    p_max_attempts,
    p_expires_at,
    p_resend_available_at,
    p_request_id,
    null,
    null,
    'pending',
    null,
    v_now,
    v_now
  );

  RETURN jsonb_build_object(
    'created', true,
    'idempotent', false,
    'challenge_id', p_challenge_id,
    'error_code', null,
    'retry_after_seconds', 0
  );
END;
$$;

ALTER FUNCTION public.create_phone_otp_login_challenge_v2(
  uuid, uuid, text, text, text,
  timestamptz, timestamptz, uuid, integer
) OWNER TO postgres;

-- ACL: revoke from public, grant only to service_role
REVOKE ALL
  ON FUNCTION public.create_phone_otp_login_challenge_v2(
    uuid, uuid, text, text, text,
    timestamptz, timestamptz, uuid, integer
  )
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.create_phone_otp_login_challenge_v2(
    uuid, uuid, text, text, text,
    timestamptz, timestamptz, uuid, integer
  )
  TO service_role;
