-- Phase 5E-C3: Atomic Phone OTP Verification Claim RPC
-- Creates the claim_phone_otp_login_challenge_v2 function.
-- No new tables, no triggers, no policies, no views, no edge function changes.

CREATE FUNCTION public.claim_phone_otp_login_challenge_v2(
  p_challenge_id uuid,
  p_otp_hash text,
  p_claim_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_now timestamptz;
  v_user_id uuid;
  v_phone_hash text;
  v_stored_otp_hash text;
  v_status text;
  v_delivery_status text;
  v_attempt_count integer;
  v_max_attempts integer;
  v_expires_at timestamptz;
  v_existing_claim_id uuid;
  v_existing_claim_expires_at timestamptz;
  v_challenge_found boolean;
  v_next_attempt_count integer;
  v_new_claim_expires_at timestamptz;
BEGIN
  v_now := clock_timestamp();

  -- Input validation (fail-closed for NULL)
  IF p_challenge_id IS NULL OR p_otp_hash IS NULL OR p_claim_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CLAIM_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  IF p_otp_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_CLAIM_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  -- Lock and read the challenge row
  SELECT
    user_id,
    phone_hash,
    otp_hash,
    status,
    delivery_status,
    attempt_count,
    max_attempts,
    expires_at,
    claim_id,
    claim_expires_at
    INTO
      v_user_id,
      v_phone_hash,
      v_stored_otp_hash,
      v_status,
      v_delivery_status,
      v_attempt_count,
      v_max_attempts,
      v_expires_at,
      v_existing_claim_id,
      v_existing_claim_expires_at
    FROM private.phone_otp_login_challenges_v2
    WHERE id = p_challenge_id
    FOR UPDATE;

  v_challenge_found := FOUND;

  -- Challenge not found
  IF NOT v_challenge_found THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'idempotent', false,
      'user_id', null,
      'phone_hash', null,
      'error_code', 'INVALID_CHALLENGE',
      'attempts_remaining', null,
      'claim_expires_at', null
    );
  END IF;

  -- Delivery Gate: only sent delivery_status allows OTP check
  IF v_delivery_status IS DISTINCT FROM 'sent' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'idempotent', false,
      'user_id', null,
      'phone_hash', null,
      'error_code', 'DELIVERY_NOT_CONFIRMED',
      'attempts_remaining', null,
      'claim_expires_at', null
    );
  END IF;

  -- Terminal states: no UPDATE
  IF v_status = 'consumed' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'idempotent', false,
      'user_id', null,
      'phone_hash', null,
      'error_code', 'ALREADY_CONSUMED',
      'attempts_remaining', null,
      'claim_expires_at', null
    );
  END IF;

  IF v_status = 'superseded' OR v_status = 'delivery_failed' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'idempotent', false,
      'user_id', null,
      'phone_hash', null,
      'error_code', 'INVALID_CHALLENGE',
      'attempts_remaining', null,
      'claim_expires_at', null
    );
  END IF;

  IF v_status = 'locked' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'idempotent', false,
      'user_id', null,
      'phone_hash', null,
      'error_code', 'CHALLENGE_LOCKED',
      'attempts_remaining', 0,
      'claim_expires_at', null
    );
  END IF;

  -- Expiration check
  IF v_expires_at <= v_now THEN
    UPDATE private.phone_otp_login_challenges_v2
      SET status = 'expired',
          claim_id = null,
          claim_expires_at = null,
          updated_at = v_now
      WHERE id = p_challenge_id
        AND status IN ('pending', 'processing');

    RETURN jsonb_build_object(
      'claimed', false,
      'idempotent', false,
      'user_id', null,
      'phone_hash', null,
      'error_code', 'CHALLENGE_EXPIRED',
      'attempts_remaining', null,
      'claim_expires_at', null
    );
  END IF;

  -- Processing state handling
  IF v_status = 'processing' THEN
    -- Active claim with same claim ID and same OTP: idempotent
    IF v_existing_claim_expires_at > v_now
       AND v_existing_claim_id IS NOT DISTINCT FROM p_claim_id
       AND p_otp_hash IS NOT DISTINCT FROM v_stored_otp_hash
    THEN
      RETURN jsonb_build_object(
        'claimed', true,
        'idempotent', true,
        'user_id', v_user_id,
        'phone_hash', v_phone_hash,
        'error_code', null,
        'attempts_remaining', v_max_attempts - v_attempt_count,
        'claim_expires_at', v_existing_claim_expires_at
      );
    END IF;

    -- Active claim with same claim ID but different OTP: mismatch
    IF v_existing_claim_expires_at > v_now
       AND v_existing_claim_id IS NOT DISTINCT FROM p_claim_id
       AND p_otp_hash IS DISTINCT FROM v_stored_otp_hash
    THEN
      RAISE EXCEPTION 'CLAIM_ID_REUSE_MISMATCH' USING ERRCODE = '22023';
    END IF;

    -- Active claim belonging to a different claim ID
    IF v_existing_claim_expires_at > v_now
       AND v_existing_claim_id IS DISTINCT FROM p_claim_id
    THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'idempotent', false,
        'user_id', null,
        'phone_hash', null,
        'error_code', 'ACTIVE_PROCESSING',
        'attempts_remaining', null,
        'claim_expires_at', null
      );
    END IF;

    -- Expired claim: reset to pending and continue
    IF v_existing_claim_expires_at <= v_now THEN
      UPDATE private.phone_otp_login_challenges_v2
        SET status = 'pending',
            claim_id = null,
            claim_expires_at = null,
            updated_at = v_now
        WHERE id = p_challenge_id
          AND status = 'processing';

      v_status := 'pending';
      v_existing_claim_id := null;
      v_existing_claim_expires_at := null;
    END IF;
  END IF;

  -- After processing handling, only pending/sent is valid for OTP check
  IF v_status IS DISTINCT FROM 'pending' OR v_delivery_status IS DISTINCT FROM 'sent' THEN
    RAISE EXCEPTION 'INVALID_CHALLENGE_STATE' USING ERRCODE = '22023';
  END IF;

  -- Wrong OTP
  IF p_otp_hash IS DISTINCT FROM v_stored_otp_hash THEN
    v_next_attempt_count := LEAST(v_attempt_count + 1, v_max_attempts);

    IF v_next_attempt_count >= v_max_attempts THEN
      UPDATE private.phone_otp_login_challenges_v2
        SET attempt_count = v_max_attempts,
            status = 'locked',
            claim_id = null,
            claim_expires_at = null,
            updated_at = v_now
        WHERE id = p_challenge_id
          AND status = 'pending'
          AND delivery_status = 'sent'
          AND attempt_count = v_attempt_count;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CHALLENGE_STATE_CHANGED' USING ERRCODE = '40001';
      END IF;

      RETURN jsonb_build_object(
        'claimed', false,
        'idempotent', false,
        'user_id', null,
        'phone_hash', null,
        'error_code', 'CHALLENGE_LOCKED',
        'attempts_remaining', 0,
        'claim_expires_at', null
      );
    END IF;

    UPDATE private.phone_otp_login_challenges_v2
      SET attempt_count = v_next_attempt_count,
          status = 'pending',
          claim_id = null,
          claim_expires_at = null,
          updated_at = v_now
      WHERE id = p_challenge_id
        AND status = 'pending'
        AND delivery_status = 'sent'
        AND attempt_count = v_attempt_count;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CHALLENGE_STATE_CHANGED' USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
      'claimed', false,
      'idempotent', false,
      'user_id', null,
      'phone_hash', null,
      'error_code', 'INVALID_OTP',
      'attempts_remaining', v_max_attempts - v_next_attempt_count,
      'claim_expires_at', null
    );
  END IF;

  -- Correct OTP: claim the challenge
  v_new_claim_expires_at := v_now + pg_catalog.make_interval(secs => 30);

  UPDATE private.phone_otp_login_challenges_v2
    SET status = 'processing',
        claim_id = p_claim_id,
        claim_expires_at = v_new_claim_expires_at,
        updated_at = v_now
    WHERE id = p_challenge_id
      AND status = 'pending'
      AND delivery_status = 'sent'
      AND attempt_count = v_attempt_count
      AND otp_hash = v_stored_otp_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHALLENGE_STATE_CHANGED' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'idempotent', false,
    'user_id', v_user_id,
    'phone_hash', v_phone_hash,
    'error_code', null,
    'attempts_remaining', v_max_attempts - v_attempt_count,
    'claim_expires_at', v_new_claim_expires_at
  );
END;
$$;

ALTER FUNCTION public.claim_phone_otp_login_challenge_v2(
  uuid, text, uuid
) OWNER TO postgres;

-- ACL: revoke from public, grant only to service_role
REVOKE ALL
  ON FUNCTION public.claim_phone_otp_login_challenge_v2(
    uuid, text, uuid
  )
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.claim_phone_otp_login_challenge_v2(
    uuid, text, uuid
  )
  TO service_role;
