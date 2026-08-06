-- Phase 5E-C5B Fix: Fail-closed Session AAL Validation
-- Replaces the function to add explicit v_session_aal IS NULL check before the NOT IN allowlist.
-- Only the AAL validation logic changes; all other logic is preserved.

CREATE OR REPLACE FUNCTION public.authorize_phone_otp_gateway_session_v1(
  p_session_id uuid,
  p_user_id uuid,
  p_challenge_id uuid,
  p_claim_id uuid,
  p_phone_hash text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_now timestamptz;
  v_challenge_user_id uuid;
  v_challenge_phone_hash text;
  v_challenge_status text;
  v_delivery_status text;
  v_existing_claim_id uuid;
  v_claim_expires_at timestamptz;
  v_consumed_at timestamptz;
  v_challenge_updated_at timestamptz;
  v_challenge_found boolean;
  v_session_created_at timestamptz;
  v_session_not_after timestamptz;
  v_session_aal text;
  v_session_found boolean;
  v_existing_gateway_user_id uuid;
  v_existing_gateway_method text;
  v_existing_identifier_hash text;
  v_existing_ip_hash text;
  v_existing_session_created_at timestamptz;
  v_gateway_found boolean;
  v_backend_ready text;
  v_canonical_enabled text;
  v_inserted_session_id uuid;
BEGIN
  v_now := clock_timestamp();

  -- Input validation: all six parameters must be non-null
  IF p_session_id IS NULL
     OR p_user_id IS NULL
     OR p_challenge_id IS NULL
     OR p_claim_id IS NULL
     OR p_phone_hash IS NULL
     OR p_ip_hash IS NULL
  THEN
    RAISE EXCEPTION 'INVALID_PHONE_OTP_GATEWAY_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  -- Hash validation: exactly 64 lowercase hex chars
  IF p_phone_hash !~ '^[0-9a-f]{64}$' OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_PHONE_OTP_GATEWAY_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  -- 1. Lock challenge row (FOR UPDATE)
  SELECT
    user_id,
    phone_hash,
    status,
    delivery_status,
    claim_id,
    claim_expires_at,
    consumed_at,
    updated_at
    INTO
      v_challenge_user_id,
      v_challenge_phone_hash,
      v_challenge_status,
      v_delivery_status,
      v_existing_claim_id,
      v_claim_expires_at,
      v_consumed_at,
      v_challenge_updated_at
    FROM private.phone_otp_login_challenges_v2
    WHERE id = p_challenge_id
    FOR UPDATE;

  v_challenge_found := FOUND;

  IF NOT v_challenge_found THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'idempotent', false,
      'session_id', null,
      'error_code', 'INVALID_CHALLENGE'
    );
  END IF;

  -- 2. Lock and validate session (FOR KEY SHARE)
  SELECT
    created_at,
    not_after,
    aal::text
    INTO
      v_session_created_at,
      v_session_not_after,
      v_session_aal
    FROM auth.sessions
    WHERE id = p_session_id
      AND user_id = p_user_id
    FOR KEY SHARE;

  v_session_found := FOUND;

  IF NOT v_session_found
     OR v_session_created_at IS NULL
     OR (
       v_session_not_after IS NOT NULL
       AND v_session_not_after <= v_now
     )
     OR v_session_aal IS NULL
     OR v_session_aal NOT IN ('aal1', 'aal2', 'aal3')
  THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'idempotent', false,
      'session_id', null,
      'error_code', 'INVALID_SESSION'
    );
  END IF;

  -- 3. Read existing gateway row (FOR UPDATE)
  SELECT
    user_id,
    login_method,
    identifier_hash,
    ip_hash,
    auth_session_created_at
    INTO
      v_existing_gateway_user_id,
      v_existing_gateway_method,
      v_existing_identifier_hash,
      v_existing_ip_hash,
      v_existing_session_created_at
    FROM private.password_gateway_session_authorizations
    WHERE session_id = p_session_id
    FOR UPDATE;

  v_gateway_found := FOUND;

  -- 8. Idempotency: challenge already consumed
  IF v_challenge_status = 'consumed' AND v_consumed_at IS NOT NULL THEN
    IF v_gateway_found
       AND v_challenge_user_id = p_user_id
       AND v_challenge_phone_hash = p_phone_hash
       AND v_existing_gateway_user_id = p_user_id
       AND v_existing_gateway_method = 'phone_otp'
       AND v_existing_identifier_hash = p_phone_hash
       AND v_existing_ip_hash = p_ip_hash
       AND v_existing_session_created_at = v_session_created_at
    THEN
      RETURN jsonb_build_object(
        'authorized', true,
        'idempotent', true,
        'session_id', p_session_id,
        'error_code', null
      );
    ELSE
      RETURN jsonb_build_object(
        'authorized', false,
        'idempotent', false,
        'session_id', null,
        'error_code', 'ALREADY_CONSUMED'
      );
    END IF;
  END IF;

  -- 9. Readiness gate (only for new authorization)
  SELECT value INTO v_backend_ready
    FROM public.system_config
    WHERE section = 'security' AND key = 'phone_otp_login_backend_ready';

  SELECT value INTO v_canonical_enabled
    FROM public.system_config
    WHERE section = 'security' AND key = 'phone_login_canonical_enabled';

  IF v_backend_ready IS DISTINCT FROM 'true' OR v_canonical_enabled IS DISTINCT FROM 'true' THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'idempotent', false,
      'session_id', null,
      'error_code', 'BACKEND_NOT_READY'
    );
  END IF;

  -- 10. Challenge state validation for new authorization
  IF v_challenge_user_id IS DISTINCT FROM p_user_id
     OR v_challenge_phone_hash IS DISTINCT FROM p_phone_hash
  THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'idempotent', false,
      'session_id', null,
      'error_code', 'INVALID_CHALLENGE'
    );
  END IF;

  IF v_challenge_status IS DISTINCT FROM 'processing'
     OR v_delivery_status IS DISTINCT FROM 'sent'
  THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'idempotent', false,
      'session_id', null,
      'error_code', 'INVALID_CHALLENGE_STATE'
    );
  END IF;

  IF v_existing_claim_id IS DISTINCT FROM p_claim_id THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'idempotent', false,
      'session_id', null,
      'error_code', 'CLAIM_MISMATCH'
    );
  END IF;

  IF v_claim_expires_at <= v_now THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'idempotent', false,
      'session_id', null,
      'error_code', 'CLAIM_EXPIRED'
    );
  END IF;

  -- 11. Session must not predate claim
  IF v_session_created_at < v_challenge_updated_at THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'idempotent', false,
      'session_id', null,
      'error_code', 'SESSION_PREDATES_CLAIM'
    );
  END IF;

  -- 12. Existing gateway row in processing path
  IF v_gateway_found THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'idempotent', false,
      'session_id', null,
      'error_code', 'SESSION_ALREADY_AUTHORIZED'
    );
  END IF;

  -- 13. Insert gateway authorization
  INSERT INTO private.password_gateway_session_authorizations (
    session_id,
    user_id,
    login_method,
    identifier_hash,
    ip_hash,
    auth_session_created_at
  )
  VALUES (
    p_session_id,
    p_user_id,
    'phone_otp',
    p_phone_hash,
    p_ip_hash,
    v_session_created_at
  )
  ON CONFLICT (session_id) DO NOTHING
  RETURNING session_id
  INTO v_inserted_session_id;

  IF v_inserted_session_id IS NULL THEN
    RAISE EXCEPTION 'GATEWAY_SESSION_STATE_CHANGED' USING ERRCODE = '40001';
  END IF;

  -- 14. Consume challenge atomically
  UPDATE private.phone_otp_login_challenges_v2
    SET status = 'consumed',
        consumed_at = v_now,
        claim_id = null,
        claim_expires_at = null,
        updated_at = v_now
    WHERE id = p_challenge_id
      AND user_id = p_user_id
      AND phone_hash = p_phone_hash
      AND status = 'processing'
      AND delivery_status = 'sent'
      AND claim_id = p_claim_id
      AND claim_expires_at > v_now
      AND consumed_at IS NULL
      AND updated_at = v_challenge_updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHALLENGE_STATE_CHANGED' USING ERRCODE = '40001';
  END IF;

  -- 15. Success
  RETURN jsonb_build_object(
    'authorized', true,
    'idempotent', false,
    'session_id', p_session_id,
    'error_code', null
  );
END;
$$;

ALTER FUNCTION public.authorize_phone_otp_gateway_session_v1(
  uuid, uuid, uuid, uuid, text, text
) OWNER TO postgres;

-- 17. ACL
REVOKE ALL
  ON FUNCTION public.authorize_phone_otp_gateway_session_v1(
    uuid, uuid, uuid, uuid, text, text
  )
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.authorize_phone_otp_gateway_session_v1(
    uuid, uuid, uuid, uuid, text, text
  )
  TO service_role;
