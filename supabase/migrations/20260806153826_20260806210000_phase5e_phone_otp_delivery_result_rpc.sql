-- Phase 5E-C2: Phone OTP Delivery Result RPC
-- Creates the set_phone_otp_login_delivery_v2 function.
-- No new tables, no triggers, no policies, no views, no edge function changes.

CREATE FUNCTION public.set_phone_otp_login_delivery_v2(
  p_challenge_id uuid,
  p_sent boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_status text;
  v_delivery_status text;
  v_challenge_found boolean;
BEGIN
  -- Input validation (fail-closed for NULL)
  IF p_challenge_id IS NULL OR p_sent IS NULL THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_CONFIGURATION' USING ERRCODE = '22023';
  END IF;

  -- Lock and read the challenge row
  SELECT status, delivery_status
    INTO v_status, v_delivery_status
    FROM private.phone_otp_login_challenges_v2
    WHERE id = p_challenge_id
    FOR UPDATE;

  v_challenge_found := FOUND;

  -- Challenge not found
  IF NOT v_challenge_found THEN
    RETURN false;
  END IF;

  -- Successful delivery path
  IF p_sent THEN
    -- Idempotent: already sent
    IF v_status = 'pending' AND v_delivery_status = 'sent' THEN
      RETURN true;
    END IF;

    -- Only transition from pending/pending
    IF v_status = 'pending' AND v_delivery_status = 'pending' THEN
      UPDATE private.phone_otp_login_challenges_v2
        SET delivery_status = 'sent',
            updated_at = clock_timestamp()
        WHERE id = p_challenge_id
          AND status = 'pending'
          AND delivery_status = 'pending';

      RETURN FOUND;
    END IF;

    -- Cannot re-activate other states
    RETURN false;
  END IF;

  -- Failed delivery path
  -- Idempotent: already failed
  IF v_status = 'delivery_failed' AND v_delivery_status = 'failed' THEN
    RETURN true;
  END IF;

  -- Only transition from pending/pending
  IF v_status = 'pending' AND v_delivery_status = 'pending' THEN
    UPDATE private.phone_otp_login_challenges_v2
      SET status = 'delivery_failed',
          delivery_status = 'failed',
          claim_id = null,
          claim_expires_at = null,
          updated_at = clock_timestamp()
      WHERE id = p_challenge_id
        AND status = 'pending'
        AND delivery_status = 'pending';

    RETURN FOUND;
  END IF;

  -- Cannot overwrite other states
  RETURN false;
END;
$$;

ALTER FUNCTION public.set_phone_otp_login_delivery_v2(
  uuid, boolean
) OWNER TO postgres;

-- ACL: revoke from public, grant only to service_role
REVOKE ALL
  ON FUNCTION public.set_phone_otp_login_delivery_v2(
    uuid, boolean
  )
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.set_phone_otp_login_delivery_v2(
    uuid, boolean
  )
  TO service_role;
