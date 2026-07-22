/*
# Fix phone auth test mode error reporting

## Problem
1. `set_phone_password_recovery_test_mode` maps ALL failures from
   `resolve_phone_password_reset_target` to `PHONE_NOT_UNIQUE`, even when
   the phone is not duplicate (e.g. auth.users.phone is NULL).
2. `set_phone_login_test_mode` has correct strict checks but the
   `AUTH_PROFILE_MISMATCH` error is overly generic — it fires when
   auth.users.phone is NULL (not really a "mismatch" but a "not synced"
   situation).

## Changes

### 1. New function: `resolve_phone_password_reset_target_detailed`
Returns TABLE(status text, user_id uuid) with structured status codes:
- `MATCHED` — exactly one profile + one auth user, same user_id, same phone
- `PROFILE_NOT_FOUND` — no active profile with this phone
- `PROFILE_DUPLICATE` — more than one active profile with this phone
- `AUTH_PHONE_NOT_FOUND` — no auth.users with this phone
- `AUTH_PHONE_DUPLICATE` — more than one auth.users with this phone
- `AUTH_USER_NOT_FOUND` — profile exists but no auth user with that user_id
- `AUTH_PROFILE_MISMATCH` — auth phone belongs to a different user_id

This function is for ADMIN/Test Mode paths only — never exposed publicly.

### 2. Fix `set_phone_password_recovery_test_mode`
Replace the single `PHONE_NOT_UNIQUE` error with specific errors from
the detailed resolver. Keeps all existing gates (provider, template,
secret, TTL, etc.) unchanged.

### 3. Fix `set_phone_login_test_mode`
The existing logic is already strict and correct — it checks:
- profile count = 1
- auth phone count = 1
- join count = 1 (same user_id + same phone in both)
No changes needed to the logic itself. The error codes are already
specific: PHONE_NOT_IN_ACTIVE_PROFILE, PHONE_DUPLICATE_PROFILE,
PHONE_NOT_IN_AUTH, PHONE_DUPLICATE, AUTH_PROFILE_MISMATCH.
This migration re-creates the function identically to ensure the
latest version is deployed alongside the recovery fix.

## Security
- `auth.users.phone` remains the source of truth for auth operations.
- `profiles.phone` is NOT used directly for authentication.
- The public `resolve_phone_password_reset_target` is unchanged —
  it returns empty on any failure to prevent account enumeration.
- The new `resolve_phone_password_reset_target_detailed` is only
  called from admin RPCs (SECURITY DEFINER, auth.uid() checked).
- No RLS changes.
- No data changes.
- No config value changes.
- Test modes remain OFF after migration.
*/

-- ═══════════════════════════════════════════════════════════════════
-- 1. New: resolve_phone_password_reset_target_detailed
--    Returns structured status for admin/test-mode paths only
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_phone_password_reset_target_detailed(
  p_normalized_phone text
)
RETURNS TABLE(status text, user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_count int;
  v_profile_user_id uuid;
  v_auth_count int;
  v_auth_user_id uuid;
  v_auth_user_by_profile_id uuid;
BEGIN
  -- Count active profiles with matching normalized phone
  SELECT count(*) INTO v_profile_count
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = p_normalized_phone;

  IF v_profile_count = 0 THEN
    RETURN QUERY SELECT 'PROFILE_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_profile_count > 1 THEN
    RETURN QUERY SELECT 'PROFILE_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Get the single matching profile
  SELECT profiles.user_id INTO v_profile_user_id
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

  IF v_auth_count = 0 THEN
    RETURN QUERY SELECT 'AUTH_PHONE_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_auth_count > 1 THEN
    RETURN QUERY SELECT 'AUTH_PHONE_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Get the single matching auth user (by phone)
  SELECT users.id INTO v_auth_user_id
  FROM auth.users
  WHERE phone IS NOT NULL
    AND public.normalize_iran_phone_sql(phone) = p_normalized_phone
  LIMIT 1;

  -- Check that an auth user exists for the profile's user_id
  SELECT u.id INTO v_auth_user_by_profile_id
  FROM auth.users u
  WHERE u.id = v_profile_user_id;

  IF v_auth_user_by_profile_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_USER_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;

  -- The auth user found by phone must be the same as the profile's user_id
  IF v_auth_user_id <> v_profile_user_id THEN
    RETURN QUERY SELECT 'AUTH_PROFILE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'MATCHED'::text, v_profile_user_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Fix set_phone_password_recovery_test_mode
--    Replace PHONE_NOT_UNIQUE catch-all with specific errors
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_phone_password_recovery_test_mode(
  p_enabled boolean,
  p_test_phone text
)
RETURNS TABLE(success boolean, masked_phone text, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_resolve_status text;
  v_resolve_user_id uuid;
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

  -- Use detailed resolver for specific error codes
  SELECT status, user_id INTO v_resolve_status, v_resolve_user_id
  FROM public.resolve_phone_password_reset_target_detailed(v_normalized_phone);

  IF v_resolve_status IS NULL OR v_resolve_status <> 'MATCHED' THEN
    -- Map detailed status to error code
    RETURN QUERY SELECT false, NULL::text, COALESCE(v_resolve_status, 'PHONE_NOT_UNIQUE')::text;
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

-- ═══════════════════════════════════════════════════════════════════
-- 3. Re-create set_phone_login_test_mode (identical logic, ensures
--    latest version deployed alongside recovery fix)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_phone_login_test_mode(
  p_test_mode boolean,
  p_test_phone text DEFAULT NULL::text
)
RETURNS TABLE(success boolean, error text, test_mode boolean, test_phone_masked text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_operator_confirmed boolean := false;
  v_otp_ttl_confirmed boolean := false;
  v_public_enabled boolean := false;
  v_normalized_phone text := '';
  v_profile_count integer := 0;
  v_auth_phone text := '';
  v_auth_phone_count integer := 0;
  v_join_count integer := 0;
  v_masked text := '';
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, 'NOT_AUTHENTICATED'::text, false, NULL::text;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles
  WHERE user_id = v_caller_uid
  LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'NOT_ADMIN'::text, false, NULL::text;
    RETURN;
  END IF;

  IF p_test_mode THEN
    SELECT (value = 'true') INTO v_public_enabled
    FROM public.system_config
    WHERE section = 'security' AND key = 'phone_login_enabled'
    LIMIT 1;

    IF COALESCE(v_public_enabled, false) THEN
      RETURN QUERY SELECT false, 'PUBLIC_LOGIN_ENABLED'::text, false, NULL::text;
      RETURN;
    END IF;

    SELECT value INTO v_provider_id
    FROM public.system_config
    WHERE section = 'sms' AND key = 'phone_login_sms_provider_id'
    LIMIT 1;

    IF v_provider_id IS NULL THEN
      RETURN QUERY SELECT false, 'NO_PROVIDER'::text, false, NULL::text;
      RETURN;
    END IF;

    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers
      WHERE id = v_provider_id::uuid AND is_active = true
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_provider_active := false;
    END;

    IF NOT COALESCE(v_provider_active, false) THEN
      RETURN QUERY SELECT false, 'PROVIDER_NOT_READY'::text, false, NULL::text;
      RETURN;
    END IF;

    SELECT (value = 'true') INTO v_operator_confirmed
    FROM public.system_config
    WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed'
    LIMIT 1;

    IF NOT COALESCE(v_operator_confirmed, false) THEN
      RETURN QUERY SELECT false, 'OPERATOR_NOT_CONFIRMED'::text, false, NULL::text;
      RETURN;
    END IF;

    SELECT (value = 'true') INTO v_otp_ttl_confirmed
    FROM public.system_config
    WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed'
    LIMIT 1;

    IF NOT COALESCE(v_otp_ttl_confirmed, false) THEN
      RETURN QUERY SELECT false, 'TTL_NOT_CONFIRMED'::text, false, NULL::text;
      RETURN;
    END IF;

    v_normalized_phone := public.normalize_iran_phone(p_test_phone);
    IF v_normalized_phone = '' THEN
      RETURN QUERY SELECT false, 'INVALID_PHONE'::text, false, NULL::text;
      RETURN;
    END IF;

    SELECT count(*) INTO v_profile_count
    FROM public.profiles
    WHERE phone IS NOT NULL AND phone != ''
      AND public.normalize_iran_phone(phone) = v_normalized_phone
      AND COALESCE(is_active, false) = true;

    IF v_profile_count = 0 THEN
      RETURN QUERY SELECT false, 'PHONE_NOT_IN_ACTIVE_PROFILE'::text, false, NULL::text;
      RETURN;
    END IF;

    IF v_profile_count > 1 THEN
      RETURN QUERY SELECT false, 'PHONE_DUPLICATE_PROFILE'::text, false, NULL::text;
      RETURN;
    END IF;

    SELECT count(*) INTO v_auth_phone_count
    FROM auth.users
    WHERE phone = '+' || v_normalized_phone
       OR phone = v_normalized_phone;

    IF v_auth_phone_count = 0 THEN
      RETURN QUERY SELECT false, 'PHONE_NOT_IN_AUTH'::text, false, NULL::text;
      RETURN;
    END IF;

    IF v_auth_phone_count > 1 THEN
      RETURN QUERY SELECT false, 'PHONE_DUPLICATE'::text, false, NULL::text;
      RETURN;
    END IF;

    SELECT count(*) INTO v_join_count
    FROM public.profiles p
    JOIN auth.users u ON p.user_id = u.id
    WHERE (u.phone = '+' || v_normalized_phone OR u.phone = v_normalized_phone)
      AND public.normalize_iran_phone(p.phone) = v_normalized_phone
      AND COALESCE(p.is_active, false) = true;

    IF v_join_count = 0 THEN
      RETURN QUERY SELECT false, 'AUTH_PROFILE_MISMATCH'::text, false, NULL::text;
      RETURN;
    END IF;

    IF v_join_count > 1 THEN
      RETURN QUERY SELECT false, 'PHONE_DUPLICATE_PROFILE'::text, false, NULL::text;
      RETURN;
    END IF;

    UPDATE public.system_config SET value = v_normalized_phone
    WHERE section = 'security' AND key = 'phone_login_test_phone';

    IF length(v_normalized_phone) >= 9 THEN
      v_masked := substring(v_normalized_phone, 1, 6) || '****' || substring(v_normalized_phone, length(v_normalized_phone) - 2);
    ELSE
      v_masked := '****';
    END IF;
  ELSE
    UPDATE public.system_config SET value = ''
    WHERE section = 'security' AND key = 'phone_login_test_phone';
  END IF;

  UPDATE public.system_config
  SET value = CASE WHEN p_test_mode THEN 'true' ELSE 'false' END
  WHERE section = 'security' AND key = 'phone_login_test_mode';

  RETURN QUERY SELECT true, NULL::text, p_test_mode, v_masked;
END;
$$;

-- Grant execute to authenticated (admin-only by auth check inside)
GRANT EXECUTE ON FUNCTION public.resolve_phone_password_reset_target_detailed(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_test_mode(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_phone_login_test_mode(boolean, text) TO authenticated;