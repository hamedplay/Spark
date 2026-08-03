/*
# Fix phone password reset challenge ID binding

## Problem

The OTP is HMAC-hashed with a pre-generated challenge_id in the request edge function,
but the RPC `create_phone_password_reset_challenge` generates its OWN uuid internally
(`gen_random_uuid()`), ignoring the caller's ID. The verify function then hashes the
provided OTP with the RPC-returned challenge_id — which differs from the one used at
request time. Result: verify ALWAYS fails.

## Changes

1. Create a NEW overloaded function `create_phone_password_reset_challenge` that accepts
   `p_challenge_id uuid` as the first parameter and inserts EXACTLY that ID.
   - SECURITY DEFINER, search_path = '', EXECUTE only for service_role.
   - The old 4-parameter function is NOT modified or deleted.

2. REVOKE EXECUTE on the old 4-parameter `create_phone_password_reset_challenge`
   from `authenticated` (it was previously granted). Keep service_role + postgres.

3. REVOKE EXECUTE on `consume_phone_password_recovery_rate_limit(text, text)` from
   `authenticated`. Keep service_role + postgres.

4. Update `get_public_auth_config()` to also check that the password_reset_otp template
   body contains the `{{otp}}` placeholder before reporting `recovery_template_ready = true`.

## Security

- No data deleted, modified, or reset.
- No previous migration changed.
- New function is SECURITY DEFINER with search_path = '' and service_role-only access.
- Old function left in place (no active callers after this change).
*/

-- ── 1. New overload with p_challenge_id ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_phone_password_reset_challenge(
  p_challenge_id uuid,
  p_user_id uuid,
  p_phone_hash text,
  p_otp_hash text,
  p_expires_at timestamp with time zone
)
RETURNS TABLE(challenge_id uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_lock_key bigint;
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

  -- Insert new challenge with the caller-provided ID
  INSERT INTO public.phone_password_reset_challenges (
    id, user_id, phone_hash, otp_hash, status, expires_at, max_attempts
  ) VALUES (
    p_challenge_id, p_user_id, p_phone_hash, p_otp_hash, 'pending', p_expires_at, 5
  );

  RETURN QUERY SELECT p_challenge_id, true, NULL::text;
END;
$function$;

-- Grant EXECUTE only to service_role (not anon, not authenticated)
REVOKE EXECUTE ON FUNCTION public.create_phone_password_reset_challenge(
  p_challenge_id uuid, p_user_id uuid, p_phone_hash text, p_otp_hash text, p_expires_at timestamp with time zone
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_phone_password_reset_challenge(
  p_challenge_id uuid, p_user_id uuid, p_phone_hash text, p_otp_hash text, p_expires_at timestamp with time zone
) TO service_role;

-- ── 2. Revoke authenticated from old 4-param overload ────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_phone_password_reset_challenge(
  p_user_id uuid, p_phone_hash text, p_otp_hash text, p_expires_at timestamp with time zone
) FROM authenticated;

-- ── 3. Revoke authenticated from consume_phone_password_recovery_rate_limit ──
REVOKE EXECUTE ON FUNCTION public.consume_phone_password_recovery_rate_limit(
  p_phone_hash text, p_ip_hash text
) FROM authenticated;

-- ── 4. Update get_public_auth_config to check {{otp}} placeholder ─────────────
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
SET search_path TO ''
AS $function$
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
  v_template_body text := '';
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

  -- Template ready: must be active AND contain {{otp}} placeholder
  BEGIN
    SELECT body INTO v_template_body
    FROM public.notification_templates
    WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_template_ready := v_template_body IS NOT NULL AND v_template_body LIKE '%{{otp}}%';
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
$function$;

-- Preserve grants on get_public_auth_config (anon + authenticated need it for UI)
REVOKE EXECUTE ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated, service_role;
