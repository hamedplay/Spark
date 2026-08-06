-- Phase 5E-C4A: Complete Phone OTP Claim RPC
-- Creates the complete_phone_otp_login_challenge_v2 function.
-- No new tables, no triggers, no policies, no views, no edge function changes.

CREATE FUNCTION public.complete_phone_otp_login_challenge_v2(
  p_challenge_id uuid,
  p_claim_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_now timestamptz;
  v_status text;
  v_delivery_status text;
  v_existing_claim_id uuid;
  v_claim_expires_at timestamptz;
  v_consumed_at timestamptz;
  v_challenge_found boolean;
BEGIN
  v_now := clock_timestamp();

  -- Input validation (fail-closed for NULL)
  IF p_challenge_id IS NULL OR p_claim_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_COMPLETE_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  -- Lock and read the challenge row
  SELECT
    status,
    delivery_status,
    claim_id,
    claim_expires_at,
    consumed_at
    INTO
      v_status,
      v_delivery_status,
      v_existing_claim_id,
      v_claim_expires_at,
      v_consumed_at
    FROM private.phone_otp_login_challenges_v2
    WHERE id = p_challenge_id
    FOR UPDATE;

  v_challenge_found := FOUND;

  -- Challenge not found
  IF NOT v_challenge_found THEN
    RETURN jsonb_build_object(
      'completed', false,
      'idempotent', false,
      'error_code', 'INVALID_CHALLENGE'
    );
  END IF;

  -- Idempotency: already consumed
  IF v_status = 'consumed' AND v_consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'completed', true,
      'idempotent', true,
      'error_code', null
    );
  END IF;

  -- State validation for new completion
  IF v_status IS DISTINCT FROM 'processing' OR v_delivery_status IS DISTINCT FROM 'sent' THEN
    RETURN jsonb_build_object(
      'completed', false,
      'idempotent', false,
      'error_code', 'INVALID_CHALLENGE_STATE'
    );
  END IF;

  -- Claim ID must match exactly
  IF v_existing_claim_id IS DISTINCT FROM p_claim_id THEN
    RETURN jsonb_build_object(
      'completed', false,
      'idempotent', false,
      'error_code', 'CLAIM_MISMATCH'
    );
  END IF;

  -- Claim must not be expired
  IF v_claim_expires_at <= v_now THEN
    RETURN jsonb_build_object(
      'completed', false,
      'idempotent', false,
      'error_code', 'CLAIM_EXPIRED'
    );
  END IF;

  -- Successful transition: processing/sent/active exact claim → consumed/sent
  UPDATE private.phone_otp_login_challenges_v2
    SET status = 'consumed',
        consumed_at = v_now,
        claim_id = null,
        claim_expires_at = null,
        updated_at = v_now
    WHERE id = p_challenge_id
      AND status = 'processing'
      AND delivery_status = 'sent'
      AND claim_id = p_claim_id
      AND claim_expires_at > v_now
      AND consumed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHALLENGE_STATE_CHANGED' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'idempotent', false,
    'error_code', null
  );
END;
$$;

ALTER FUNCTION public.complete_phone_otp_login_challenge_v2(
  uuid, uuid
) OWNER TO postgres;

-- ACL: revoke from public, grant only to service_role
REVOKE ALL
  ON FUNCTION public.complete_phone_otp_login_challenge_v2(
    uuid, uuid
  )
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.complete_phone_otp_login_challenge_v2(
    uuid, uuid
  )
  TO service_role;
