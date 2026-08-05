/*
# Phase 4 — Registration Runtime Security Hardening

## Summary
Fixes get_public_auth_config runtime error (column "value" does not exist),
adds identifier availability RPC, atomic rate limit V2, challenge V2 RPCs
with claim_id ownership and lease management, revokes execute on V1 RPCs.

## Safety
- No prior migration modified
- No data deleted
- No MFA policy changed
- No users created or modified
*/

-- ════════════════════════════════════════════════════════════
-- 1. Fix get_public_auth_config — replace buggy column access
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_auth_config()
RETURNS TABLE(
  phone_login_enabled boolean,
  provider_ready boolean,
  operator_confirmed boolean,
  e2e_verified boolean,
  phone_login_test_mode boolean,
  phone_login_test_ready boolean,
  phone_login_ready boolean,
  otp_ttl_operator_confirmed boolean,
  phone_password_recovery_enabled boolean,
  phone_password_recovery_test_mode boolean,
  phone_password_recovery_test_ready boolean,
  phone_password_recovery_ready boolean,
  recovery_template_ready boolean,
  recovery_secret_confirmed boolean,
  recovery_ttl_valid boolean,
  recovery_ttl_seconds integer,
  phone_password_recovery_e2e_verified boolean,
  phone_login_canonical_enabled boolean,
  phone_login_canonical_ready boolean,
  phone_password_recovery_canonical_enabled boolean,
  phone_password_recovery_canonical_ready boolean,
  registration_enabled boolean,
  registration_ready boolean,
  registration_requires_admin_approval boolean,
  require_profile_completion boolean,
  registration_otp_ttl_seconds integer,
  registration_otp_resend_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_login_canonical boolean := false;


  v_recovery_canonical boolean := false;


  v_provider_id text := NULL;


  v_provider_active boolean := false;


  v_provider_ready boolean := false;


  v_origins_text text := '';


  v_origins_count int := 0;


  v_origins_set boolean := false;


  v_login_template_ready boolean := false;


  v_login_template_body text := '';


  v_recovery_template_ready boolean := false;


  v_recovery_template_body text := '';


  v_recovery_ttl_text text := '';


  v_recovery_ttl_seconds int := 0;


  v_recovery_ttl_valid boolean := false;


  v_recovery_secret_proxy boolean := false;


  v_registration_enabled boolean := false;


  v_registration_requires_admin_approval boolean := false;


  v_require_profile_completion boolean := false;


  v_reg_otp_ttl_text text := '';


  v_reg_otp_ttl_seconds int := 300;


  v_reg_otp_resend_text text := '';


  v_reg_otp_resend_seconds int := 60;


  v_reg_secret_proxy boolean := false;


  v_reg_template_ready boolean := false;


  v_reg_template_body text := '';


  v_registration_ready boolean := false;


BEGIN
  SELECT (value = 'true') INTO v_login_canonical
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_canonical_enabled' LIMIT 1;


  v_login_canonical := COALESCE(v_login_canonical, false);



  SELECT (value = 'true') INTO v_recovery_canonical
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_canonical_enabled' LIMIT 1;


  v_recovery_canonical := COALESCE(v_recovery_canonical, false);



  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;



  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT COALESCE(is_active, false) INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid LIMIT 1;


    EXCEPTION WHEN OTHERS THEN v_provider_active := false;

 END;


  END IF;


  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);



  SELECT value INTO v_origins_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1;


  v_origins_text := COALESCE(v_origins_text, '');


  IF btrim(v_origins_text) <> '' THEN
    SELECT COUNT(*) INTO v_origins_count
    FROM unnest(string_to_array(v_origins_text, ',')) AS elem
    WHERE btrim(elem) <> '';


  ELSE
    v_origins_count := 0;


  END IF;


  v_origins_set := v_origins_count > 0;



  BEGIN
    SELECT body INTO v_login_template_body
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;


    v_login_template_ready := v_login_template_body IS NOT NULL AND v_login_template_body LIKE '%{{otp}}%';


  EXCEPTION WHEN OTHERS THEN v_login_template_ready := false;

 END;



  BEGIN
    SELECT body INTO v_recovery_template_body
    FROM public.notification_templates
    WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;


    v_recovery_template_ready := v_recovery_template_body IS NOT NULL AND v_recovery_template_body LIKE '%{{otp}}%';


  EXCEPTION WHEN OTHERS THEN v_recovery_template_ready := false;

 END;



  SELECT value INTO v_recovery_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;


  BEGIN
    v_recovery_ttl_seconds := COALESCE(v_recovery_ttl_text::integer, 600);


  EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 600;

 END;


  v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400;



  SELECT (value = 'true') INTO v_recovery_secret_proxy
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_configured' LIMIT 1;


  v_recovery_secret_proxy := COALESCE(v_recovery_secret_proxy, false);



  -- FIX: use actual boolean columns from auth_security_settings, not "value"
  SELECT
    COALESCE(registration_enabled, false),
    COALESCE(registration_requires_admin_approval, false),
    COALESCE(require_profile_completion, false)
  INTO
    v_registration_enabled,
    v_registration_requires_admin_approval,
    v_require_profile_completion
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;



  SELECT value INTO v_reg_otp_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_ttl_seconds' LIMIT 1;


  BEGIN
    v_reg_otp_ttl_seconds := COALESCE(v_reg_otp_ttl_text::integer, 300);


  EXCEPTION WHEN OTHERS THEN v_reg_otp_ttl_seconds := 300;

 END;



  SELECT value INTO v_reg_otp_resend_text
  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_resend_seconds' LIMIT 1;


  BEGIN
    v_reg_otp_resend_seconds := COALESCE(v_reg_otp_resend_text::integer, 60);


  EXCEPTION WHEN OTHERS THEN v_reg_otp_resend_seconds := 60;

 END;



  SELECT (value = 'true') INTO v_reg_secret_proxy
  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_secret_configured' LIMIT 1;


  v_reg_secret_proxy := COALESCE(v_reg_secret_proxy, false);



  BEGIN
    SELECT body INTO v_reg_template_body
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'registration_phone_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;


    v_reg_template_ready := v_reg_template_body IS NOT NULL AND v_reg_template_body LIKE '%{{otp}}%';


  EXCEPTION WHEN OTHERS THEN v_reg_template_ready := false;

 END;



  v_registration_ready := v_registration_enabled
    AND v_provider_ready
    AND v_reg_template_ready
    AND v_origins_set
    AND v_reg_secret_proxy
    AND v_reg_otp_ttl_seconds >= 60 AND v_reg_otp_ttl_seconds <= 86400
    AND v_reg_otp_resend_seconds >= 30 AND v_reg_otp_resend_seconds <= 3600;



  RETURN QUERY SELECT
    false,
    v_provider_ready,
    false, false, false, false,
    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,
    false,
    false, false, false,
    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
    v_recovery_template_ready,
    v_recovery_secret_proxy,
    v_recovery_ttl_valid,
    v_recovery_ttl_seconds,
    false,
    v_login_canonical,
    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,
    v_recovery_canonical,
    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
    v_registration_enabled,
    v_registration_ready,
    v_registration_requires_admin_approval,
    v_require_profile_completion,
    v_reg_otp_ttl_seconds,
    v_reg_otp_resend_seconds;


END;


$function$;



ALTER FUNCTION public.get_public_auth_config() OWNER TO postgres;


-- Keep PUBLIC execute so anon can call it (pre-request allowlist already permits it)

-- ════════════════════════════════════════════════════════════
-- 2. check_public_registration_identifiers_available
--    Service-only boolean availability check across profiles + auth.users
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_public_registration_identifiers_available(
  p_normalized_username text,
  p_normalized_email text,
  p_normalized_phone text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_username_taken boolean := false;


  v_email_taken boolean := false;


  v_phone_taken boolean := false;


BEGIN
  -- Username: check profiles only (unique source of truth)
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE normalized_username = p_normalized_username
  ) INTO v_username_taken;



  -- Email: check both profiles and auth.users
  SELECT EXISTS(
    SELECT 1 FROM public.profiles WHERE normalized_email = p_normalized_email
  ) OR EXISTS(
    SELECT 1 FROM auth.users WHERE lower(email) = p_normalized_email
  ) INTO v_email_taken;



  -- Phone: check both profiles and auth.users
  SELECT EXISTS(
    SELECT 1 FROM public.profiles WHERE normalized_phone = p_normalized_phone
  ) OR EXISTS(
    SELECT 1 FROM auth.users
    WHERE '+' || public.normalize_iran_phone(phone) = p_normalized_phone
  ) INTO v_phone_taken;



  RETURN NOT (v_username_taken OR v_email_taken OR v_phone_taken);


END;


$function$;



ALTER FUNCTION public.check_public_registration_identifiers_available(text, text, text) OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) FROM anon;


REVOKE EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) FROM authenticated;


GRANT EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) TO service_role;



-- ════════════════════════════════════════════════════════════
-- 3. consume_public_registration_rate_limit_v2
--    Atomic count + insert with advisory locks
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.consume_public_registration_rate_limit_v2(
  p_identity_hash text,
  p_phone_hash text,
  p_ip_hash text,
  p_purpose text,
  p_identity_limit integer,
  p_phone_limit integer,
  p_ip_limit integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_identity_count int := 0;


  v_phone_count int := 0;


  v_ip_count int := 0;


  v_window_start timestamptz;


  v_identity_key bigint;


  v_phone_key bigint;


  v_ip_key bigint;


BEGIN
  -- Validate purpose
  IF p_purpose NOT IN ('registration_request', 'registration_verify') THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'INVALID_PURPOSE');


  END IF;



  -- Validate limits
  IF p_identity_limit < 1 OR p_identity_limit > 100 THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'INVALID_IDENTITY_LIMIT');


  END IF;


  IF p_phone_limit < 1 OR p_phone_limit > 100 THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'INVALID_PHONE_LIMIT');


  END IF;


  IF p_ip_limit < 1 OR p_ip_limit > 1000 THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'INVALID_IP_LIMIT');


  END IF;



  -- Validate window
  IF p_window_seconds < 60 OR p_window_seconds > 3600 THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'INVALID_WINDOW');


  END IF;



  v_window_start := clock_timestamp() - (p_window_seconds || ' seconds')::interval;



  -- Deterministic advisory lock keys from hash
  v_identity_key := ('x' || substr(md5(p_identity_hash), 1, 16))::bit(64)::bigint;


  v_phone_key := ('x' || substr(md5(p_phone_hash), 1, 16))::bit(64)::bigint;


  v_ip_key := ('x' || substr(md5(p_ip_hash), 1, 16))::bit(64)::bigint;



  -- Acquire advisory locks in fixed order: identity, phone, IP
  PERFORM pg_advisory_xact_lock(v_identity_key);


  PERFORM pg_advisory_xact_lock(v_phone_key);


  PERFORM pg_advisory_xact_lock(v_ip_key);



  -- Count existing entries in window
  SELECT count(*) INTO v_identity_count
  FROM public.public_registration_rate_limit
  WHERE identity_hash = p_identity_hash
    AND purpose = p_purpose
    AND created_at > v_window_start;



  SELECT count(*) INTO v_phone_count
  FROM public.public_registration_rate_limit
  WHERE phone_hash = p_phone_hash
    AND purpose = p_purpose
    AND created_at > v_window_start;



  SELECT count(*) INTO v_ip_count
  FROM public.public_registration_rate_limit
  WHERE ip_hash = p_ip_hash
    AND purpose = p_purpose
    AND created_at > v_window_start;



  -- Check limits
  IF v_identity_count >= p_identity_limit OR v_phone_count >= p_phone_limit OR v_ip_count >= p_ip_limit THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', p_window_seconds);


  END IF;



  -- Insert rate limit row
  INSERT INTO public.public_registration_rate_limit (identity_hash, phone_hash, ip_hash, purpose)
  VALUES (p_identity_hash, p_phone_hash, p_ip_hash, p_purpose);



  RETURN jsonb_build_object('allowed', true);


END;


$function$;



ALTER FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) FROM anon;


REVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) FROM authenticated;


GRANT EXECUTE ON FUNCTION public.consume_public_registration_rate_limit_v2(text, text, text, text, integer, integer, integer, integer) TO service_role;



-- Revoke execute on V1 rate limit from service_role (keep function, stop using it)
REVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit(text, text, text, text) FROM service_role;



-- ════════════════════════════════════════════════════════════
-- 4. Challenge V2 RPCs
-- ════════════════════════════════════════════════════════════

-- create_public_registration_challenge_v2
CREATE OR REPLACE FUNCTION public.create_public_registration_challenge_v2(
  p_challenge_id uuid,
  p_identity_hash text,
  p_email_hash text,
  p_username_hash text,
  p_phone_hash text,
  p_otp_hash text,
  p_expires_at timestamptz,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_identity_key bigint;


  v_phone_key bigint;


  v_existing record;


BEGIN
  v_identity_key := ('x' || substr(md5(p_identity_hash), 1, 16))::bit(64)::bigint;


  v_phone_key := ('x' || substr(md5(p_phone_hash), 1, 16))::bit(64)::bigint;



  PERFORM pg_advisory_xact_lock(v_identity_key);


  PERFORM pg_advisory_xact_lock(v_phone_key);



  -- Expire pending and delivery_failed challenges for same identity/phone
  UPDATE public.public_registration_challenges
  SET status = 'expired', updated_at = now()
  WHERE identity_hash = p_identity_hash
    AND phone_hash = p_phone_hash
    AND status IN ('pending', 'delivery_failed')
    AND expires_at <= now();



  -- Expire processing challenges with expired lease
  UPDATE public.public_registration_challenges
  SET status = 'expired', updated_at = now()
  WHERE identity_hash = p_identity_hash
    AND phone_hash = p_phone_hash
    AND status = 'processing'
    AND processing_expires_at <= now();



  -- Do NOT overwrite processing with valid lease — just skip

  -- Insert new challenge with provided challenge_id
  INSERT INTO public.public_registration_challenges (
    id, identity_hash, email_hash, username_hash, phone_hash, otp_hash,
    expires_at, request_id
  ) VALUES (
    p_challenge_id, p_identity_hash, p_email_hash, p_username_hash, p_phone_hash, p_otp_hash,
    p_expires_at, p_request_id
  );



  RETURN jsonb_build_object('ok', true, 'challenge_id', p_challenge_id);


END;


$function$;



ALTER FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) FROM anon;


REVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) FROM authenticated;


GRANT EXECUTE ON FUNCTION public.create_public_registration_challenge_v2(uuid, text, text, text, text, text, timestamptz, uuid) TO service_role;



-- claim_public_registration_challenge_v2
CREATE OR REPLACE FUNCTION public.claim_public_registration_challenge_v2(
  p_challenge_id uuid,
  p_identity_hash text,
  p_otp_hash text,
  p_claim_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_challenge record;


BEGIN
  SELECT * INTO v_challenge
  FROM public.public_registration_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;



  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_FOUND');


  END IF;



  -- Already consumed
  IF v_challenge.status = 'consumed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_CONSUMED', 'created_user_id', v_challenge.created_user_id);


  END IF;



  -- Locked
  IF v_challenge.status = 'locked' OR (v_challenge.locked_until IS NOT NULL AND v_challenge.locked_until > now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_LOCKED');


  END IF;



  -- Expired
  IF v_challenge.expires_at <= now() THEN
    UPDATE public.public_registration_challenges SET status = 'expired', updated_at = now()
    WHERE id = p_challenge_id;


    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED');


  END IF;



  -- Identity mismatch
  IF v_challenge.identity_hash != p_identity_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');


  END IF;



  -- Delivery failed cannot be verified
  IF v_challenge.status = 'delivery_failed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');


  END IF;



  -- Processing with valid lease — don't overwrite
  IF v_challenge.status = 'processing'
     AND v_challenge.processing_expires_at > now()
     AND v_challenge.processing_claim_id IS NOT NULL
     AND v_challenge.processing_claim_id != p_claim_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACTIVE_PROCESSING');


  END IF;



  -- Processing with expired lease — revert to pending
  IF v_challenge.status = 'processing' AND v_challenge.processing_expires_at <= now() THEN
    UPDATE public.public_registration_challenges
    SET status = 'pending',
        processing_claim_id = NULL,
        processing_started_at = NULL,
        processing_expires_at = NULL,
        updated_at = now()
    WHERE id = p_challenge_id;



    -- Re-read
    SELECT * INTO v_challenge
    FROM public.public_registration_challenges
    WHERE id = p_challenge_id
    FOR UPDATE;


  END IF;



  -- Wrong OTP
  IF v_challenge.otp_hash != p_otp_hash THEN
    UPDATE public.public_registration_challenges
    SET attempt_count = v_challenge.attempt_count + 1,
        updated_at = now()
    WHERE id = p_challenge_id;



    IF v_challenge.attempt_count + 1 >= v_challenge.max_attempts THEN
      UPDATE public.public_registration_challenges
      SET status = 'locked',
          locked_until = now() + interval '30 minutes',
          updated_at = now()
      WHERE id = p_challenge_id;


      RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_LOCKED');


    END IF;



    RETURN jsonb_build_object('ok', false, 'error', 'OTP_INVALID');


  END IF;



  -- Correct OTP — conditional update from pending to processing
  UPDATE public.public_registration_challenges
  SET status = 'processing',
      processing_claim_id = p_claim_id,
      processing_started_at = now(),
      processing_expires_at = now() + interval '5 minutes',
      updated_at = now()
  WHERE id = p_challenge_id
    AND status = 'pending';



  IF NOT FOUND THEN
    -- Race condition: someone else claimed it
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');


  END IF;



  RETURN jsonb_build_object('ok', true, 'claim_id', p_claim_id);


END;


$function$;



ALTER FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) FROM anon;


REVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) FROM authenticated;


GRANT EXECUTE ON FUNCTION public.claim_public_registration_challenge_v2(uuid, text, text, uuid) TO service_role;



-- release_public_registration_claim_v2
CREATE OR REPLACE FUNCTION public.release_public_registration_claim_v2(
  p_challenge_id uuid,
  p_claim_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.public_registration_challenges
  SET status = 'pending',
      processing_claim_id = NULL,
      processing_started_at = NULL,
      processing_expires_at = NULL,
      updated_at = now()
  WHERE id = p_challenge_id
    AND status = 'processing'
    AND processing_claim_id = p_claim_id;


END;


$function$;



ALTER FUNCTION public.release_public_registration_claim_v2(uuid, uuid) OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.release_public_registration_claim_v2(uuid, uuid) FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.release_public_registration_claim_v2(uuid, uuid) FROM anon;


REVOKE EXECUTE ON FUNCTION public.release_public_registration_claim_v2(uuid, uuid) FROM authenticated;


GRANT EXECUTE ON FUNCTION public.release_public_registration_claim_v2(uuid, uuid) TO service_role;



-- mark_registration_delivery_failed_v2
CREATE OR REPLACE FUNCTION public.mark_registration_delivery_failed_v2(
  p_challenge_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.public_registration_challenges
  SET status = 'delivery_failed',
      updated_at = now()
  WHERE id = p_challenge_id
    AND status = 'pending';


END;


$function$;



ALTER FUNCTION public.mark_registration_delivery_failed_v2(uuid) OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed_v2(uuid) FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed_v2(uuid) FROM anon;


REVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed_v2(uuid) FROM authenticated;


GRANT EXECUTE ON FUNCTION public.mark_registration_delivery_failed_v2(uuid) TO service_role;



-- Revoke execute on V1 challenge RPCs from service_role
REVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge(text, text, text, text, text, timestamptz, uuid) FROM service_role;


REVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge(uuid, text, text) FROM service_role;


REVOKE EXECUTE ON FUNCTION public.release_public_registration_claim(uuid) FROM service_role;


REVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed(uuid) FROM service_role;


;
