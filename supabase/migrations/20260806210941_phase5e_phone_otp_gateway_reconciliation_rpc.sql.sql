-- Phase 5E-D3: Gateway Reconciliation RPC
-- Read-only RPC to determine actual commit state of a gateway authorization
-- after an ambiguous Edge Function failure. No writes.

CREATE FUNCTION public.reconcile_phone_otp_gateway_session_v1(
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
  v_challenge_delivery_status text;
  v_challenge_claim_id uuid;
  v_challenge_claim_expires_at timestamptz;
  v_challenge_consumed_at timestamptz;
  v_challenge_found boolean;
  v_session_created_at timestamptz;
  v_session_not_after timestamptz;
  v_session_aal text;
  v_session_found boolean;
  v_gateway_user_id uuid;
  v_gateway_method text;
  v_gateway_identifier_hash text;
  v_gateway_ip_hash text;
  v_gateway_session_created_at timestamptz;
  v_gateway_found boolean;
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
    consumed_at
    INTO
      v_challenge_user_id,
      v_challenge_phone_hash,
      v_challenge_status,
      v_challenge_delivery_status,
      v_challenge_claim_id,
      v_challenge_claim_expires_at,
      v_challenge_consumed_at
    FROM private.phone_otp_login_challenges_v2
    WHERE id = p_challenge_id
    FOR UPDATE;

  v_challenge_found := FOUND;

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

  -- 3. Read existing gateway row (FOR UPDATE)
  SELECT
    user_id,
    login_method,
    identifier_hash,
    ip_hash,
    auth_session_created_at
    INTO
      v_gateway_user_id,
      v_gateway_method,
      v_gateway_identifier_hash,
      v_gateway_ip_hash,
      v_gateway_session_created_at
    FROM private.password_gateway_session_authorizations
    WHERE session_id = p_session_id
    FOR UPDATE;

  v_gateway_found := FOUND;

  -- Evaluate authorized state
  IF v_challenge_found
     AND v_session_found
     AND v_session_created_at IS NOT NULL
     AND (v_session_not_after IS NULL OR v_session_not_after > v_now)
     AND v_session_aal IS NOT NULL
     AND v_session_aal IN ('aal1', 'aal2', 'aal3')
     AND v_challenge_user_id = p_user_id
     AND v_challenge_phone_hash = p_phone_hash
     AND v_challenge_status = 'consumed'
     AND v_challenge_consumed_at IS NOT NULL
     AND v_challenge_claim_id IS NULL
     AND v_challenge_claim_expires_at IS NULL
     AND v_gateway_found
     AND v_gateway_user_id = p_user_id
     AND v_gateway_method = 'phone_otp'
     AND v_gateway_identifier_hash = p_phone_hash
     AND v_gateway_ip_hash = p_ip_hash
     AND v_gateway_session_created_at = v_session_created_at
  THEN
    RETURN jsonb_build_object(
      'authorized', true,
      'error_code', null
    );
  END IF;

  -- Evaluate NOT_COMMITTED state
  IF v_challenge_found
     AND v_challenge_user_id = p_user_id
     AND v_challenge_phone_hash = p_phone_hash
     AND v_challenge_status = 'processing'
     AND v_challenge_delivery_status = 'sent'
     AND v_challenge_claim_id = p_claim_id
     AND v_challenge_claim_expires_at IS NOT NULL
     AND v_challenge_claim_expires_at > v_now
     AND v_challenge_consumed_at IS NULL
     AND NOT v_gateway_found
  THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'error_code', 'NOT_COMMITTED'
    );
  END IF;

  -- Everything else is inconsistent
  RETURN jsonb_build_object(
    'authorized', false,
    'error_code', 'INCONSISTENT_STATE'
  );
END;
$$;

ALTER FUNCTION public.reconcile_phone_otp_gateway_session_v1(
  uuid, uuid, uuid, uuid, text, text
) OWNER TO postgres;

REVOKE ALL
  ON FUNCTION public.reconcile_phone_otp_gateway_session_v1(
    uuid, uuid, uuid, uuid, text, text
  )
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.reconcile_phone_otp_gateway_session_v1(
    uuid, uuid, uuid, uuid, text, text
  )
  TO service_role;