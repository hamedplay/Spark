/*
# Fix phone normalization in resolve and revalidate RPCs

The previous resolve_phone_password_reset_target used regexp_replace
to strip non-digits, but this doesn't normalize Iranian phone numbers
to the canonical 989... format. For example, 09122632232 strips to
09122632232, not 989122632232.

This migration adds a normalize_iran_phone_sql() helper and updates
all RPCs that compare phone numbers to use it.

## Changes
- New function: normalize_iran_phone_sql(text) — SQL-side Iran phone normalization
- Updated: resolve_phone_password_reset_target — uses normalize_iran_phone_sql
- Updated: revalidate_phone_password_reset_target — uses normalize_iran_phone_sql
- Updated: set_phone_password_recovery_test_mode — uses normalize_iran_phone_sql
*/

-- ═══════════════════════════════════════════════════════════════════════
-- 1. normalize_iran_phone_sql helper
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.normalize_iran_phone_sql(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text;
BEGIN
  v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF v_digits ~ '^00989\d{9}$' THEN
    RETURN substring(v_digits, 3);
  ELSIF v_digits ~ '^989\d{9}$' THEN
    RETURN v_digits;
  ELSIF v_digits ~ '^09\d{9}$' THEN
    RETURN '98' || substring(v_digits, 2);
  ELSIF v_digits ~ '^9\d{9}$' THEN
    RETURN '98' || v_digits;
  END IF;
  RETURN '';
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_iran_phone_sql(text) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Update resolve_phone_password_reset_target
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.resolve_phone_password_reset_target(text);

CREATE OR REPLACE FUNCTION public.resolve_phone_password_reset_target(
  p_normalized_phone text
)
RETURNS TABLE(user_id uuid, resolved_phone_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_count int;
  v_profile_user_id uuid;
  v_profile_phone text;
  v_auth_count int;
  v_auth_user_id uuid;
  v_auth_phone text;
BEGIN
  -- Count all active profiles with matching normalized phone
  SELECT count(*) INTO v_profile_count
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = p_normalized_phone;

  IF v_profile_count = 0 OR v_profile_count > 1 THEN
    RETURN;
  END IF;

  -- Get the single matching profile
  SELECT profiles.user_id, profiles.phone
  INTO v_profile_user_id, v_profile_phone
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = p_normalized_phone
  LIMIT 1;

  -- Count auth users with matching normalized phone
  SELECT count(*) INTO v_auth_count
  FROM auth.users
  WHERE phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = p_normalized_phone;

  IF v_auth_count = 0 OR v_auth_count > 1 THEN
    RETURN;
  END IF;

  -- Get the single matching auth user
  SELECT users.id, users.phone
  INTO v_auth_user_id, v_auth_phone
  FROM auth.users
  WHERE phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = p_normalized_phone
  LIMIT 1;

  -- user_id must match
  IF v_auth_user_id IS NULL OR v_auth_user_id <> v_profile_user_id THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_profile_user_id, p_normalized_phone;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_phone_password_reset_target(text) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Update revalidate_phone_password_reset_target
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.revalidate_phone_password_reset_target(uuid, text);

CREATE OR REPLACE FUNCTION public.revalidate_phone_password_reset_target(
  p_user_id uuid,
  p_expected_phone_hash text
)
RETURNS TABLE(valid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile record;
  v_auth_user record;
BEGIN
  -- Check profile exists and is active
  SELECT user_id, phone, is_active INTO v_profile
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  IF NOT FOUND OR v_profile.is_active <> true THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- Check auth user exists
  SELECT id, phone INTO v_auth_user
  FROM auth.users
  WHERE id = p_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- Normalized phones must match
  IF public.normalize_iran_phone_sql(v_auth_user.phone) <> public.normalize_iran_phone_sql(v_profile.phone) THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION public.revalidate_phone_password_reset_target(uuid, text) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Update set_phone_password_recovery_test_mode
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
  v_masked text;
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
    RETURN QUERY SELECT false, NULL::text, 'TEST_MODE_STILL_ACTIVE'::text;
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

  -- Gate: test phone must be valid and unique
  v_normalized_phone := public.normalize_iran_phone_sql(p_test_phone);
  IF v_normalized_phone !~ '^989\d{9}$' THEN
    RETURN QUERY SELECT false, NULL::text, 'INVALID_PHONE'::text;
    RETURN;
  END IF;

  SELECT count(*) INTO v_profile_count
  FROM public.profiles
  WHERE is_active = true AND phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = v_normalized_phone;

  SELECT count(*) INTO v_auth_count
  FROM auth.users
  WHERE phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = v_normalized_phone;

  IF v_profile_count <> 1 OR v_auth_count <> 1 THEN
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
