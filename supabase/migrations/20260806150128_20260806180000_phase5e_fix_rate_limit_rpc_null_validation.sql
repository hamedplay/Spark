-- Phase 5E-B3 Fix: Fail-closed NULL Input Validation
-- Replaces the RPC with the same signature/logic but adds explicit NULL checks for all six parameters.

CREATE OR REPLACE FUNCTION public.consume_phone_otp_login_rate_limit_v2(
  p_purpose text,
  p_phone_hash text,
  p_ip_hash text,
  p_phone_limit integer,
  p_ip_limit integer,
  p_window_seconds integer
)
RETURNS TABLE(
  allowed boolean,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_now timestamptz;
  v_cutoff timestamptz;
  v_phone_count integer;
  v_ip_count integer;
  v_oldest_phone_created_at timestamptz;
  v_oldest_ip_created_at timestamptz;
  v_phone_retry integer;
  v_ip_retry integer;
  v_retry_after integer;
  v_phone_lock_key bigint;
  v_ip_lock_key bigint;
BEGIN
  -- Input validation (fail-closed for NULL)
  IF p_purpose IS NULL
     OR p_purpose NOT IN (
       'phone_otp_login_request',
       'phone_otp_login_verify'
     )
  THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_CONFIGURATION'
      USING ERRCODE = '22023';
  END IF;

  IF p_phone_hash IS NULL
     OR p_phone_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_CONFIGURATION'
      USING ERRCODE = '22023';
  END IF;

  IF p_ip_hash IS NULL
     OR p_ip_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_CONFIGURATION'
      USING ERRCODE = '22023';
  END IF;

  IF p_phone_limit IS NULL
     OR p_phone_limit < 1
     OR p_phone_limit > 100
  THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_CONFIGURATION'
      USING ERRCODE = '22023';
  END IF;

  IF p_ip_limit IS NULL
     OR p_ip_limit < 1
     OR p_ip_limit > 1000
  THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_CONFIGURATION'
      USING ERRCODE = '22023';
  END IF;

  IF p_window_seconds IS NULL
     OR p_window_seconds < 30
     OR p_window_seconds > 86400
  THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_CONFIGURATION'
      USING ERRCODE = '22023';
  END IF;

  -- Fixed timestamp for the entire operation
  v_now := clock_timestamp();
  v_cutoff := v_now - pg_catalog.make_interval(secs => p_window_seconds);

  -- Advisory lock keys with distinct domain prefixes to prevent overlap
  v_phone_lock_key := pg_catalog.hashtextextended('phone-otp-login-rate-v2|phone|' || p_purpose || '|' || p_phone_hash, 0);
  v_ip_lock_key := pg_catalog.hashtextextended('phone-otp-login-rate-v2|ip|' || p_purpose || '|' || p_ip_hash, 0);

  -- Acquire phone lock first, then IP lock (fixed order)
  PERFORM pg_catalog.pg_advisory_xact_lock(v_phone_lock_key);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_ip_lock_key);

  -- Phone count: only purpose + phone_hash + created_at
  SELECT count(*), MIN(created_at)
    INTO v_phone_count, v_oldest_phone_created_at
    FROM private.phone_otp_login_rate_limit_v2
    WHERE purpose = p_purpose
      AND phone_hash = p_phone_hash
      AND created_at >= v_cutoff;

  -- IP count: only purpose + ip_hash + created_at
  SELECT count(*), MIN(created_at)
    INTO v_ip_count, v_oldest_ip_created_at
    FROM private.phone_otp_login_rate_limit_v2
    WHERE purpose = p_purpose
      AND ip_hash = p_ip_hash
      AND created_at >= v_cutoff;

  -- Check phone limit
  IF v_phone_count >= p_phone_limit THEN
    v_phone_retry := GREATEST(1, CEIL(
      EXTRACT(EPOCH FROM (v_oldest_phone_created_at + pg_catalog.make_interval(secs => p_window_seconds) - v_now))
    )::integer);
  ELSE
    v_phone_retry := 0;
  END IF;

  -- Check IP limit
  IF v_ip_count >= p_ip_limit THEN
    v_ip_retry := GREATEST(1, CEIL(
      EXTRACT(EPOCH FROM (v_oldest_ip_created_at + pg_catalog.make_interval(secs => p_window_seconds) - v_now))
    )::integer);
  ELSE
    v_ip_retry := 0;
  END IF;

  -- If either limit exceeded, deny
  IF v_phone_retry > 0 OR v_ip_retry > 0 THEN
    v_retry_after := GREATEST(v_phone_retry, v_ip_retry);
    RETURN QUERY SELECT false, v_retry_after;
    RETURN;
  END IF;

  -- Both limits allow: insert exactly one row
  INSERT INTO private.phone_otp_login_rate_limit_v2 (
    purpose,
    phone_hash,
    ip_hash,
    created_at
  )
  VALUES (
    p_purpose,
    p_phone_hash,
    p_ip_hash,
    v_now
  );

  RETURN QUERY SELECT true, 0;
END;
$$;

ALTER FUNCTION public.consume_phone_otp_login_rate_limit_v2(
  text, text, text, integer, integer, integer
) OWNER TO postgres;

-- ACL: revoke from public, grant only to service_role
REVOKE ALL
  ON FUNCTION public.consume_phone_otp_login_rate_limit_v2(
    text, text, text, integer, integer, integer
  )
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.consume_phone_otp_login_rate_limit_v2(
    text, text, text, integer, integer, integer
  )
  TO service_role;
