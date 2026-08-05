-- Phase 5A: Unified password login gateway
-- 1. Rate limit table for password login attempts (stores only hashes)
CREATE TABLE private.password_login_rate_limit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  method text NOT NULL CHECK (
    method IN ('username', 'email', 'phone')
  ),
  identifier_hash text NOT NULL,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX password_login_rate_limit_pair_idx
ON private.password_login_rate_limit (
  method,
  identifier_hash,
  ip_hash,
  created_at DESC
);

CREATE INDEX password_login_rate_limit_ip_idx
ON private.password_login_rate_limit (
  ip_hash,
  created_at DESC
);

REVOKE ALL
ON private.password_login_rate_limit
FROM PUBLIC, anon, authenticated, service_role;

-- 2. Consume rate limit RPC (SECURITY DEFINER, service_role only)
CREATE OR REPLACE FUNCTION public.consume_password_login_rate_limit_v1(
  p_method text,
  p_identifier_hash text,
  p_ip_hash text,
  p_pair_limit integer,
  p_ip_limit integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_pair_count integer;
  v_ip_count integer;
  v_cutoff timestamptz;
  v_pair_lock bigint;
  v_ip_lock bigint;
BEGIN
  -- Validate method
  IF p_method NOT IN ('username', 'email', 'phone') THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;

  -- Validate hashes
  IF p_identifier_hash IS NULL OR length(p_identifier_hash) = 0 OR length(p_identifier_hash) > 256 THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;
  IF p_ip_hash IS NULL OR length(p_ip_hash) = 0 OR length(p_ip_hash) > 256 THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;

  -- Validate limits
  IF p_pair_limit IS NULL OR p_pair_limit < 1 OR p_pair_limit > 100 THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;
  IF p_ip_limit IS NULL OR p_ip_limit < 1 OR p_ip_limit > 500 THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;

  -- Validate window
  IF p_window_seconds IS NULL OR p_window_seconds < 30 OR p_window_seconds > 86400 THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;

  v_cutoff := clock_timestamp() - (p_window_seconds || ' seconds')::interval;

  -- Advisory locks for concurrency control on pair and IP
  v_pair_lock := hashText(p_method || '|' || p_identifier_hash || '|' || p_ip_hash);
  v_ip_lock := hashText(p_ip_hash);

  PERFORM pg_advisory_xact_lock(v_pair_lock);
  PERFORM pg_advisory_xact_lock(v_ip_lock);

  -- Count attempts for this pair
  SELECT count(*) INTO v_pair_count
  FROM private.password_login_rate_limit
  WHERE method = p_method
    AND identifier_hash = p_identifier_hash
    AND ip_hash = p_ip_hash
    AND created_at >= v_cutoff;

  -- Count total attempts for this IP
  SELECT count(*) INTO v_ip_count
  FROM private.password_login_rate_limit
  WHERE ip_hash = p_ip_hash
    AND created_at >= v_cutoff;

  -- Check pair limit
  IF v_pair_count >= p_pair_limit THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', p_window_seconds);
  END IF;

  -- Check IP limit
  IF v_ip_count >= p_ip_limit THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', p_window_seconds);
  END IF;

  -- Allowed: insert the attempt
  INSERT INTO private.password_login_rate_limit (method, identifier_hash, ip_hash)
  VALUES (p_method, p_identifier_hash, p_ip_hash);

  RETURN jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
END;
$function$;

ALTER FUNCTION public.consume_password_login_rate_limit_v1(
  text, text, text, integer, integer, integer
) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION
public.consume_password_login_rate_limit_v1(
  text, text, text, integer, integer, integer
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.consume_password_login_rate_limit_v1(
  text, text, text, integer, integer, integer
)
TO service_role;

-- 3. Fix get_public_login_methods: phone_login no longer depends on SMS/OTP readiness
CREATE OR REPLACE FUNCTION public.get_public_login_methods()
RETURNS TABLE(
  username_login boolean,
  email_login boolean,
  phone_login boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row public.auth_security_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT true, true, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_row.username_login,
    v_row.email_login,
    v_row.phone_login;
END;
$function$;

-- Preserve existing grants (anon, authenticated, service_role all have EXECUTE)
GRANT EXECUTE ON FUNCTION public.get_public_login_methods()
TO anon, authenticated, service_role;
