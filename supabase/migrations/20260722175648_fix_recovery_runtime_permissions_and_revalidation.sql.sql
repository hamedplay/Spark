/*
# Fix Recovery Service Grants and Phone-Bound Revalidation

## Summary
1. Explicitly GRANT all service-role RPCs TO service_role (after REVOKE from PUBLIC/anon/authenticated)
2. Redesign revalidate_phone_password_reset_target to accept p_challenge_id and return normalized_phone + phone_hash
3. Add phone_hash output to claim_phone_password_reset_completion
4. Fix set_phone_password_recovery_test_mode to use resolve RPC and return PUBLIC_RECOVERY_ENABLED error
5. Add phone_password_recovery_e2e_verified to get_public_auth_config as independent field
6. Add processing_expires_at column and lease-based processing cleanup
7. Add cleanup_stale_phone_password_reset_processing() RPC
8. Update create_phone_password_reset_challenge to expire stale processing challenges

## All changes are additive — no existing columns dropped, no prior migrations altered.
*/

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Add processing_expires_at column
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.phone_password_reset_challenges
  ADD COLUMN IF NOT EXISTS processing_expires_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Revoke and GRANT all service-role RPCs TO service_role
-- ═══════════════════════════════════════════════════════════════════════

-- resolve_phone_password_reset_target(text)
REVOKE ALL ON FUNCTION public.resolve_phone_password_reset_target(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_phone_password_reset_target(text) TO service_role;

-- consume_phone_password_recovery_request_limit(text, text, text, integer, integer, integer)
REVOKE ALL ON FUNCTION public.consume_phone_password_recovery_request_limit(text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_phone_password_recovery_request_limit(text, text, text, integer, integer, integer) TO service_role;

-- consume_phone_password_recovery_verify_limit(text, text, integer, integer)
REVOKE ALL ON FUNCTION public.consume_phone_password_recovery_verify_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_phone_password_recovery_verify_limit(text, text, integer, integer) TO service_role;

-- consume_phone_password_recovery_complete_limit(text, text, integer, integer)
REVOKE ALL ON FUNCTION public.consume_phone_password_recovery_complete_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_phone_password_recovery_complete_limit(text, text, integer, integer) TO service_role;

-- create_phone_password_reset_challenge(uuid, text, text, timestamptz)
REVOKE ALL ON FUNCTION public.create_phone_password_reset_challenge(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_phone_password_reset_challenge(uuid, text, text, timestamptz) TO service_role;

-- verify_phone_password_reset_challenge(uuid, text, text, timestamptz)
REVOKE ALL ON FUNCTION public.verify_phone_password_reset_challenge(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_phone_password_reset_challenge(uuid, text, text, timestamptz) TO service_role;

-- claim_phone_password_reset_completion(uuid, text, uuid)
REVOKE ALL ON FUNCTION public.claim_phone_password_reset_completion(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_phone_password_reset_completion(uuid, text, uuid) TO service_role;

-- finalize_phone_password_reset_completion(uuid, uuid, boolean)
REVOKE ALL ON FUNCTION public.finalize_phone_password_reset_completion(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_phone_password_reset_completion(uuid, uuid, boolean) TO service_role;

-- normalize_iran_phone_sql(text)
REVOKE ALL ON FUNCTION public.normalize_iran_phone_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_iran_phone_sql(text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Redesign revalidate_phone_password_reset_target
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.revalidate_phone_password_reset_target(uuid, text);

CREATE OR REPLACE FUNCTION public.revalidate_phone_password_reset_target(
  p_challenge_id uuid
)
RETURNS TABLE(
  valid boolean,
  user_id uuid,
  normalized_phone text,
  phone_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge record;
  v_profile record;
  v_auth_user record;
  v_profile_count int;
  v_auth_count int;
  v_profile_normalized text;
  v_auth_normalized text;
BEGIN
  -- 1. Read challenge by p_challenge_id
  SELECT * INTO v_challenge
  FROM public.phone_password_reset_challenges
  WHERE id = p_challenge_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 2. user_id and phone_hash come from the challenge itself
  -- 3. Exactly one active profile with matching normalized phone
  SELECT count(*) INTO v_profile_count
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = public.normalize_iran_phone_sql(
      -- We need to find the profile by user_id and check its phone
      (SELECT phone FROM public.profiles WHERE user_id = v_challenge.user_id LIMIT 1)
    );

  -- Actually, let's do this properly: find the profile by user_id
  SELECT user_id, phone, is_active INTO v_profile
  FROM public.profiles
  WHERE user_id = v_challenge.user_id
  LIMIT 1;

  IF NOT FOUND OR v_profile.is_active <> true THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_profile_normalized := public.normalize_iran_phone_sql(v_profile.phone);

  -- Check exactly one active profile has this normalized phone
  SELECT count(*) INTO v_profile_count
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = v_profile_normalized;

  IF v_profile_count <> 1 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 4. Exactly one auth user with matching phone
  SELECT id, phone INTO v_auth_user
  FROM auth.users
  WHERE id = v_challenge.user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_auth_normalized := public.normalize_iran_phone_sql(v_auth_user.phone);

  SELECT count(*) INTO v_auth_count
  FROM auth.users
  WHERE phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = v_auth_normalized;

  IF v_auth_count <> 1 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 5. Profile user_id, Auth User id, and Challenge user_id must all be the same
  IF v_profile.user_id <> v_auth_user.id OR v_profile.user_id <> v_challenge.user_id THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 6. Auth and Profile normalized phones must match
  IF v_auth_normalized <> v_profile_normalized THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 7. Return valid with normalized_phone and phone_hash from challenge
  -- 8. No raw phone is returned or logged
  RETURN QUERY SELECT true, v_challenge.user_id, v_profile_normalized, v_challenge.phone_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.revalidate_phone_password_reset_target(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revalidate_phone_password_reset_target(uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Update claim_phone_password_reset_completion to also return phone_hash
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.claim_phone_password_reset_completion(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.claim_phone_password_reset_completion(
  p_challenge_id uuid,
  p_provided_reset_token_hash text,
  p_claim_id uuid
)
RETURNS TABLE(
  success boolean,
  user_id uuid,
  phone_hash text,
  error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge record;
  v_new_complete_attempt int;
BEGIN
  SELECT * INTO v_challenge
  FROM public.phone_password_reset_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Must be verified
  IF v_challenge.status <> 'verified' THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Check reset token expiry
  IF v_challenge.reset_expires_at IS NOT NULL AND v_challenge.reset_expires_at < now() THEN
    UPDATE public.phone_password_reset_challenges
    SET status = 'expired', updated_at = now()
    WHERE id = p_challenge_id;
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Check max complete attempts
  IF v_challenge.complete_attempt_count >= v_challenge.max_attempts THEN
    UPDATE public.phone_password_reset_challenges
    SET status = 'locked', locked_until = now() + interval '1 hour', updated_at = now()
    WHERE id = p_challenge_id;
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Verify reset token hash
  IF v_challenge.reset_token_hash IS NULL OR v_challenge.reset_token_hash <> p_provided_reset_token_hash THEN
    v_new_complete_attempt := v_challenge.complete_attempt_count + 1;
    IF v_new_complete_attempt >= v_challenge.max_attempts THEN
      UPDATE public.phone_password_reset_challenges
      SET complete_attempt_count = v_new_complete_attempt,
          status = 'locked',
          locked_until = now() + interval '1 hour',
          updated_at = now()
      WHERE id = p_challenge_id;
    ELSE
      UPDATE public.phone_password_reset_challenges
      SET complete_attempt_count = v_new_complete_attempt, updated_at = now()
      WHERE id = p_challenge_id;
    END IF;
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Claim: transition verified → processing with lease
  UPDATE public.phone_password_reset_challenges
  SET status = 'processing',
      processing_claim_id = p_claim_id,
      processing_started_at = now(),
      processing_expires_at = now() + interval '5 minutes',
      updated_at = now()
  WHERE id = p_challenge_id
    AND status = 'verified';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_challenge.user_id, v_challenge.phone_hash, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_phone_password_reset_completion(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_phone_password_reset_completion(uuid, text, uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Update create_phone_password_reset_challenge to expire stale processing
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.create_phone_password_reset_challenge(uuid, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.create_phone_password_reset_challenge(
  p_user_id uuid,
  p_phone_hash text,
  p_otp_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE(challenge_id uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_key bigint;
  v_new_id uuid := gen_random_uuid();
  v_active_count int;
BEGIN
  v_lock_key := ('x' || substr(md5(p_user_id::text), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Expire all previous pending/verified challenges for this user
  UPDATE public.phone_password_reset_challenges
  SET status = 'expired', updated_at = now()
  WHERE user_id = p_user_id
    AND status IN ('pending', 'verified');

  -- Expire stale processing challenges (lease expired)
  UPDATE public.phone_password_reset_challenges
  SET status = 'expired',
      reset_token_hash = NULL,
      processing_claim_id = NULL,
      processing_started_at = NULL,
      processing_expires_at = NULL,
      updated_at = now()
  WHERE user_id = p_user_id
    AND status = 'processing'
    AND processing_expires_at IS NOT NULL
    AND processing_expires_at < now();

  -- Check if there's still an active processing challenge (not expired)
  SELECT count(*) INTO v_active_count
  FROM public.phone_password_reset_challenges
  WHERE user_id = p_user_id
    AND status = 'processing'
    AND (processing_expires_at IS NULL OR processing_expires_at >= now());

  IF v_active_count > 0 THEN
    RETURN QUERY SELECT NULL::uuid, false, 'ACTIVE_PROCESSING'::text;
    RETURN;
  END IF;

  -- Insert new challenge
  INSERT INTO public.phone_password_reset_challenges (
    id, user_id, phone_hash, otp_hash, status, expires_at, max_attempts
  ) VALUES (
    v_new_id, p_user_id, p_phone_hash, p_otp_hash, 'pending', p_expires_at, 5
  );

  RETURN QUERY SELECT v_new_id, true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.create_phone_password_reset_challenge(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_phone_password_reset_challenge(uuid, text, text, timestamptz) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Update finalize_phone_password_reset_completion to clear processing_expires_at
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.finalize_phone_password_reset_completion(uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.finalize_phone_password_reset_completion(
  p_challenge_id uuid,
  p_claim_id uuid,
  p_success boolean
)
RETURNS TABLE(success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge record;
BEGIN
  SELECT * INTO v_challenge
  FROM public.phone_password_reset_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'NOT_FOUND'::text;
    RETURN;
  END IF;

  -- Must be processing with matching claim_id
  IF v_challenge.status <> 'processing' OR v_challenge.processing_claim_id IS NULL OR v_challenge.processing_claim_id <> p_claim_id THEN
    RETURN QUERY SELECT false, 'CLAIM_MISMATCH'::text;
    RETURN;
  END IF;

  IF p_success THEN
    -- Finalize as consumed
    UPDATE public.phone_password_reset_challenges
    SET status = 'consumed',
        consumed_at = now(),
        reset_token_hash = NULL,
        processing_claim_id = NULL,
        processing_started_at = NULL,
        processing_expires_at = NULL,
        updated_at = now()
    WHERE id = p_challenge_id;

    -- Expire all other challenges for this user
    UPDATE public.phone_password_reset_challenges
    SET status = 'expired', updated_at = now()
    WHERE user_id = v_challenge.user_id
      AND id <> p_challenge_id
      AND status IN ('pending', 'verified');

    RETURN QUERY SELECT true, NULL::text;
  ELSE
    -- Release claim: back to verified, increment attempt
    DECLARE
      v_new_attempt int := v_challenge.complete_attempt_count + 1;
    BEGIN
      IF v_new_attempt >= v_challenge.max_attempts THEN
        UPDATE public.phone_password_reset_challenges
        SET status = 'locked',
            locked_until = now() + interval '1 hour',
            complete_attempt_count = v_new_attempt,
            processing_claim_id = NULL,
            processing_started_at = NULL,
            processing_expires_at = NULL,
            updated_at = now()
        WHERE id = p_challenge_id;
      ELSE
        UPDATE public.phone_password_reset_challenges
        SET status = 'verified',
            complete_attempt_count = v_new_attempt,
            processing_claim_id = NULL,
            processing_started_at = NULL,
            processing_expires_at = NULL,
            updated_at = now()
        WHERE id = p_challenge_id;
      END IF;
      RETURN QUERY SELECT true, NULL::text;
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_phone_password_reset_completion(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_phone_password_reset_completion(uuid, uuid, boolean) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. cleanup_stale_phone_password_reset_processing
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_stale_phone_password_reset_processing()
RETURNS TABLE(cleaned_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.phone_password_reset_challenges
  SET status = 'expired',
      reset_token_hash = NULL,
      processing_claim_id = NULL,
      processing_started_at = NULL,
      processing_expires_at = NULL,
      updated_at = now()
  WHERE status = 'processing'
    AND processing_expires_at IS NOT NULL
    AND processing_expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_phone_password_reset_processing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_phone_password_reset_processing() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. Update set_phone_password_recovery_test_mode
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.set_phone_password_recovery_test_mode(boolean, text);

CREATE OR REPLACE FUNCTION public.set_phone_password_recovery_test_mode(
  p_enabled boolean,
  p_test_phone text
)
RETURNS TABLE(success boolean, masked_phone text, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_provider_ready boolean := false;
  v_template_ready boolean := false;
  v_secret_confirmed boolean := false;
  v_ttl_text text := '';
  v_ttl_seconds int := 0;
  v_public_enabled boolean := false;
  v_normalized_phone text;
  v_profile_count int;
  v_auth_count int;
  v_profile_user_id uuid;
  v_auth_user_id uuid;
  v_masked text;
  v_resolve_result record;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'NOT_AUTHENTICATED'::text;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles WHERE user_id = v_caller_uid LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, NULL::text, 'NOT_ADMIN'::text;
    RETURN;
  END IF;

  -- Disable path
  IF NOT p_enabled THEN
    UPDATE public.system_config SET value = 'false'
    WHERE section = 'security' AND key = 'phone_password_recovery_test_mode';
    UPDATE public.system_config SET value = ''
    WHERE section = 'security' AND key = 'phone_password_recovery_test_phone';
    RETURN QUERY SELECT true, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Enable path: all gates must pass

  -- Gate: public recovery must be false
  SELECT (value = 'true') INTO v_public_enabled
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_enabled' LIMIT 1;

  IF COALESCE(v_public_enabled, false) THEN
    RETURN QUERY SELECT false, NULL::text, 'PUBLIC_RECOVERY_ENABLED'::text;
    RETURN;
  END IF;

  -- Gate: provider ready
  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid AND is_active = true LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;
  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);

  IF NOT v_provider_ready THEN
    RETURN QUERY SELECT false, NULL::text, 'PROVIDER_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: template ready
  BEGIN
    SELECT EXISTS(
      SELECT 1 FROM public.notification_templates
      WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    ) INTO v_template_ready;
  EXCEPTION WHEN OTHERS THEN v_template_ready := false; END;

  IF NOT v_template_ready THEN
    RETURN QUERY SELECT false, NULL::text, 'TEMPLATE_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: secret confirmed
  SELECT (value = 'true') INTO v_secret_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed' LIMIT 1;

  IF NOT COALESCE(v_secret_confirmed, false) THEN
    RETURN QUERY SELECT false, NULL::text, 'SECRET_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate: TTL valid
  SELECT value INTO v_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;

  BEGIN
    v_ttl_seconds := v_ttl_text::integer;
  EXCEPTION WHEN OTHERS THEN v_ttl_seconds := 0; END;

  IF v_ttl_seconds < 60 OR v_ttl_seconds > 86400 THEN
    RETURN QUERY SELECT false, NULL::text, 'INVALID_TTL'::text;
    RETURN;
  END IF;

  -- Gate: test phone must be valid
  v_normalized_phone := public.normalize_iran_phone_sql(p_test_phone);
  IF v_normalized_phone !~ '^989\d{9}$' THEN
    RETURN QUERY SELECT false, NULL::text, 'INVALID_PHONE'::text;
    RETURN;
  END IF;

  -- Use resolve RPC to verify exactly one active profile and one auth user with same user_id
  SELECT * INTO v_resolve_result
  FROM public.resolve_phone_password_reset_target(v_normalized_phone);

  IF NOT FOUND OR v_resolve_result.user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'PHONE_NOT_UNIQUE'::text;
    RETURN;
  END IF;

  -- All gates passed — enable test mode
  UPDATE public.system_config SET value = 'true'
  WHERE section = 'security' AND key = 'phone_password_recovery_test_mode';
  UPDATE public.system_config SET value = p_test_phone
  WHERE section = 'security' AND key = 'phone_password_recovery_test_phone';

  -- Mask phone: 98912345678 → 98912****78
  v_masked := substr(v_normalized_phone, 1, 5) || '****' || substr(v_normalized_phone, length(v_normalized_phone) - 1);

  RETURN QUERY SELECT true, v_masked, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_password_recovery_test_mode(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_test_mode(boolean, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. Update get_public_auth_config to add phone_password_recovery_e2e_verified
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_public_auth_config();

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
  phone_password_recovery_e2e_verified boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_login_enabled boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_operator_confirmed boolean := false;
  v_login_e2e boolean := false;
  v_test_mode boolean := false;
  v_otp_ttl_confirmed boolean := false;
  v_provider_ready boolean := false;

  v_recovery_enabled boolean := false;
  v_recovery_e2e boolean := false;
  v_recovery_test_mode boolean := false;
  v_recovery_test_phone text := '';
  v_recovery_secret_confirmed boolean := false;
  v_recovery_otp_ttl text := '';
  v_recovery_ttl_seconds int := 0;
  v_recovery_ttl_valid boolean := false;

  v_template_ready boolean := false;
BEGIN
  -- Login config
  SELECT (value = 'true') INTO v_login_enabled
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_enabled' LIMIT 1;

  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid AND is_active = true LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;
  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);

  SELECT (value = 'true') INTO v_operator_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed' LIMIT 1;

  SELECT (value = 'true') INTO v_login_e2e
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_e2e_verified' LIMIT 1;

  SELECT (value = 'true') INTO v_test_mode
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_test_mode' LIMIT 1;

  SELECT (value = 'true') INTO v_otp_ttl_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed' LIMIT 1;

  -- Recovery config
  SELECT (value = 'true') INTO v_recovery_enabled
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_enabled' LIMIT 1;

  SELECT (value = 'true') INTO v_recovery_e2e
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_e2e_verified' LIMIT 1;

  SELECT (value = 'true') INTO v_recovery_test_mode
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_test_mode' LIMIT 1;

  SELECT value INTO v_recovery_test_phone
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_test_phone' LIMIT 1;

  SELECT (value = 'true') INTO v_recovery_secret_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed' LIMIT 1;

  SELECT value INTO v_recovery_otp_ttl
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;

  BEGIN
    v_recovery_ttl_seconds := v_recovery_otp_ttl::integer;
  EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 0; END;
  v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400;

  BEGIN
    SELECT EXISTS(
      SELECT 1 FROM public.notification_templates
      WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    ) INTO v_template_ready;
  EXCEPTION WHEN OTHERS THEN v_template_ready := false; END;

  RETURN QUERY SELECT
    -- Login fields
    v_login_enabled,
    v_provider_ready,
    COALESCE(v_operator_confirmed, false),
    COALESCE(v_login_e2e, false),
    COALESCE(v_test_mode, false),
    v_provider_ready AND COALESCE(v_operator_confirmed, false) AND COALESCE(v_otp_ttl_confirmed, false),
    v_login_enabled AND v_provider_ready AND COALESCE(v_operator_confirmed, false)
      AND COALESCE(v_otp_ttl_confirmed, false) AND COALESCE(v_login_e2e, false),
    COALESCE(v_otp_ttl_confirmed, false),
    -- Recovery fields
    COALESCE(v_recovery_enabled, false),
    COALESCE(v_recovery_test_mode, false),
    v_provider_ready AND v_template_ready AND COALESCE(v_recovery_secret_confirmed, false) AND v_recovery_ttl_valid,
    COALESCE(v_recovery_enabled, false)
      AND v_provider_ready
      AND v_template_ready
      AND COALESCE(v_recovery_secret_confirmed, false)
      AND v_recovery_ttl_valid
      AND COALESCE(v_recovery_e2e, false),
    -- Extra fields for UI
    v_template_ready,
    COALESCE(v_recovery_secret_confirmed, false),
    v_recovery_ttl_valid,
    v_recovery_ttl_seconds,
    -- Independent recovery E2E field
    COALESCE(v_recovery_e2e, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. Update set_phone_password_recovery_config to use PUBLIC_RECOVERY_ENABLED
--     (already uses TEST_MODE_STILL_ACTIVE which is fine for the reverse case)
-- ═══════════════════════════════════════════════════════════════════════
-- The existing set_phone_password_recovery_config already checks test_mode
-- and returns TEST_MODE_STILL_ACTIVE. This is correct for the enable path
-- (public recovery can't be enabled while test mode is active).
-- No change needed here.
