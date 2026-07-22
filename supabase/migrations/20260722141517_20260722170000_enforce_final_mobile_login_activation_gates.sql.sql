-- ═══════════════════════════════════════════════════════════════════════
-- Enforce final mobile login activation gates
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Rewrite set_phone_login_config with strict activation gates
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.set_phone_login_config(boolean, uuid);

CREATE OR REPLACE FUNCTION public.set_phone_login_config(
  p_enabled boolean,
  p_provider_id uuid
)
RETURNS TABLE(success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_provider_active boolean := false;
  v_operator_confirmed boolean := false;
  v_otp_ttl_confirmed boolean := false;
  v_ttl_text text := '';
  v_ttl_seconds integer := 0;
  v_e2e_verified boolean := false;
  v_test_mode boolean := false;
BEGIN
  -- ── 1. Auth check ──────────────────────────────────────────────────
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, 'NOT_AUTHENTICATED'::text;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles
  WHERE user_id = v_caller_uid
  LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'NOT_ADMIN'::text;
    RETURN;
  END IF;

  -- ── 2. Disable path: always succeeds ───────────────────────────────
  IF NOT p_enabled THEN
    INSERT INTO public.system_config (section, key, value, value_type, label, description)
    VALUES ('security', 'phone_login_enabled', 'false', 'boolean',
      'ورود با شماره موبایل', 'امکان ورود کاربران با شماره موبایل و کد یک‌بارمصرف')
    ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value;
    RETURN QUERY SELECT true, NULL::text;
    RETURN;
  END IF;

  -- ── 3. Enable path: all gates must pass ────────────────────────────

  -- Gate 3a: provider required
  IF p_provider_id IS NULL THEN
    RETURN QUERY SELECT false, 'PROVIDER_REQUIRED'::text;
    RETURN;
  END IF;

  -- Gate 3b: provider exists and is active
  BEGIN
    SELECT is_active INTO v_provider_active
    FROM public.sms_providers
    WHERE id = p_provider_id AND is_active = true
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_provider_active := false;
  END;

  IF NOT COALESCE(v_provider_active, false) THEN
    RETURN QUERY SELECT false, 'PROVIDER_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate 3c: hook operator confirmed
  SELECT (value = 'true') INTO v_operator_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed'
  LIMIT 1;

  IF NOT COALESCE(v_operator_confirmed, false) THEN
    RETURN QUERY SELECT false, 'HOOK_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate 3d: TTL operator confirmed
  SELECT (value = 'true') INTO v_otp_ttl_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed'
  LIMIT 1;

  IF NOT COALESCE(v_otp_ttl_confirmed, false) THEN
    RETURN QUERY SELECT false, 'TTL_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate 3e: TTL valid number in range 60-86400
  SELECT value INTO v_ttl_text
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_seconds'
  LIMIT 1;

  BEGIN
    v_ttl_seconds := v_ttl_text::integer;
  EXCEPTION WHEN OTHERS THEN
    v_ttl_seconds := 0;
  END;

  IF v_ttl_seconds < 60 OR v_ttl_seconds > 86400 THEN
    RETURN QUERY SELECT false, 'INVALID_TTL'::text;
    RETURN;
  END IF;

  -- Gate 3f: E2E verified
  SELECT (value = 'true') INTO v_e2e_verified
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_e2e_verified'
  LIMIT 1;

  IF NOT COALESCE(v_e2e_verified, false) THEN
    RETURN QUERY SELECT false, 'E2E_NOT_VERIFIED'::text;
    RETURN;
  END IF;

  -- Gate 3g: test mode must be off
  SELECT (value = 'true') INTO v_test_mode
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_test_mode'
  LIMIT 1;

  IF COALESCE(v_test_mode, false) THEN
    RETURN QUERY SELECT false, 'TEST_MODE_STILL_ACTIVE'::text;
    RETURN;
  END IF;

  -- ── All gates passed — save config ────────────────────────────────
  INSERT INTO public.system_config (section, key, value, value_type, label, description)
  VALUES ('security', 'phone_login_enabled', 'true', 'boolean',
    'ورود با شماره موبایل', 'امکان ورود کاربران با شماره موبایل و کد یک‌بارمصرف')
  ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.system_config (section, key, value, value_type, label, description)
  VALUES ('sms', 'phone_login_sms_provider_id', p_provider_id::text, 'string',
    'سرویس‌دهنده پیامک ورود موبایلی',
    'سرویس‌دهنده‌ای که برای ارسال کد یک‌بارمصرف ورود استفاده می‌شود')
  ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_login_config(boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_login_config(boolean, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Update get_public_auth_config: phone_login_ready includes otp_ttl
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
  otp_ttl_operator_confirmed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enabled boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_operator_confirmed boolean := false;
  v_e2e_verified boolean := false;
  v_test_mode boolean := false;
  v_otp_ttl_confirmed boolean := false;
  v_provider_ready boolean := false;
BEGIN
  SELECT (value = 'true') INTO v_enabled
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_enabled'
  LIMIT 1;

  SELECT value INTO v_provider_id
  FROM public.system_config
  WHERE section = 'sms' AND key = 'phone_login_sms_provider_id'
  LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers
      WHERE id = v_provider_id::uuid AND is_active = true
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_provider_active := false;
    END;
  END IF;

  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);

  SELECT (value = 'true') INTO v_operator_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed'
  LIMIT 1;

  SELECT (value = 'true') INTO v_e2e_verified
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_e2e_verified'
  LIMIT 1;

  SELECT (value = 'true') INTO v_test_mode
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_test_mode'
  LIMIT 1;

  SELECT (value = 'true') INTO v_otp_ttl_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed'
  LIMIT 1;

  RETURN QUERY SELECT
    v_enabled,
    v_provider_ready,
    COALESCE(v_operator_confirmed, false),
    COALESCE(v_e2e_verified, false),
    COALESCE(v_test_mode, false),
    -- test_ready = provider_ready AND operator_confirmed AND otp_ttl_operator_confirmed
    v_provider_ready
      AND COALESCE(v_operator_confirmed, false)
      AND COALESCE(v_otp_ttl_confirmed, false),
    -- ready (public) = enabled AND provider_ready AND operator_confirmed AND otp_ttl_operator_confirmed AND e2e_verified
    v_enabled
      AND v_provider_ready
      AND COALESCE(v_operator_confirmed, false)
      AND COALESCE(v_otp_ttl_confirmed, false)
      AND COALESCE(v_e2e_verified, false),
    COALESCE(v_otp_ttl_confirmed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Update set_phone_login_test_mode: reject if public login enabled
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.set_phone_login_test_mode(boolean, text);

CREATE OR REPLACE FUNCTION public.set_phone_login_test_mode(
  p_test_mode boolean,
  p_test_phone text DEFAULT NULL
)
RETURNS TABLE(
  success boolean,
  error text,
  test_mode boolean,
  test_phone_masked text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  -- ── 1. Auth check ──────────────────────────────────────────────────
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

  -- ── 2. If enabling test mode, validate prerequisites ─────────────────
  IF p_test_mode THEN
    -- Reject if public login is enabled
    SELECT (value = 'true') INTO v_public_enabled
    FROM public.system_config
    WHERE section = 'security' AND key = 'phone_login_enabled'
    LIMIT 1;

    IF COALESCE(v_public_enabled, false) THEN
      RETURN QUERY SELECT false, 'PUBLIC_LOGIN_ENABLED'::text, false, NULL::text;
      RETURN;
    END IF;

    -- Check provider_ready
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

    -- Check operator_confirmed
    SELECT (value = 'true') INTO v_operator_confirmed
    FROM public.system_config
    WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed'
    LIMIT 1;

    IF NOT COALESCE(v_operator_confirmed, false) THEN
      RETURN QUERY SELECT false, 'OPERATOR_NOT_CONFIRMED'::text, false, NULL::text;
      RETURN;
    END IF;

    -- Check otp_ttl_operator_confirmed
    SELECT (value = 'true') INTO v_otp_ttl_confirmed
    FROM public.system_config
    WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed'
    LIMIT 1;

    IF NOT COALESCE(v_otp_ttl_confirmed, false) THEN
      RETURN QUERY SELECT false, 'TTL_NOT_CONFIRMED'::text, false, NULL::text;
      RETURN;
    END IF;

    -- Normalize and validate test phone
    v_normalized_phone := public.normalize_iran_phone(p_test_phone);
    IF v_normalized_phone = '' THEN
      RETURN QUERY SELECT false, 'INVALID_PHONE'::text, false, NULL::text;
      RETURN;
    END IF;

    -- Check test phone belongs to active profiles (exact count)
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

    -- Check test phone exists in auth.users and is unique
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

    -- Check auth.users phone belongs to the same profile user (exact count)
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

    -- All checks passed — save test phone (normalized)
    UPDATE public.system_config SET value = v_normalized_phone
    WHERE section = 'security' AND key = 'phone_login_test_phone';

    -- Mask: first 6 + **** + last 3
    IF length(v_normalized_phone) >= 9 THEN
      v_masked := substring(v_normalized_phone, 1, 6) || '****' || substring(v_normalized_phone, length(v_normalized_phone) - 2);
    ELSE
      v_masked := '****';
    END IF;
  ELSE
    -- Disabling test mode — clear test phone
    UPDATE public.system_config SET value = ''
    WHERE section = 'security' AND key = 'phone_login_test_phone';
  END IF;

  -- Save test mode flag
  UPDATE public.system_config
  SET value = CASE WHEN p_test_mode THEN 'true' ELSE 'false' END
  WHERE section = 'security' AND key = 'phone_login_test_mode';

  RETURN QUERY SELECT true, NULL::text, p_test_mode, v_masked;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_login_test_mode(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_login_test_mode(boolean, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Harden set_phone_login_otp_ttl: use UPSERT + verify after save
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.set_phone_login_otp_ttl(integer);

CREATE OR REPLACE FUNCTION public.set_phone_login_otp_ttl(
  p_ttl_seconds integer
)
RETURNS TABLE(
  success boolean,
  error text,
  ttl_seconds integer,
  lock_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_lock_seconds integer := 0;
  v_verify_ttl text := '';
  v_verify_confirmed text := '';
BEGIN
  -- ── Auth check ──────────────────────────────────────────────────────
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, 'NOT_AUTHENTICATED'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles
  WHERE user_id = v_caller_uid
  LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'NOT_ADMIN'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  -- ── Validate range ──────────────────────────────────────────────────
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RETURN QUERY SELECT false, 'INVALID_TTL'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  -- ── UPSERT TTL ──────────────────────────────────────────────────────
  INSERT INTO public.system_config (section, key, value, value_type, label, description)
  VALUES ('security', 'phone_login_otp_ttl_seconds', p_ttl_seconds::text, 'number',
    'مدت اعتبار OTP موبایل (ثانیه)', 'TTL واقعی OTP از تنظیمات Supabase Auth. Lock = TTL + 120 ثانیه')
  ON CONFLICT (section, key)
  DO UPDATE SET value = EXCLUDED.value;

  -- ── UPSERT operator confirmed ───────────────────────────────────────
  INSERT INTO public.system_config (section, key, value, value_type, label, description)
  VALUES ('security', 'phone_login_otp_ttl_operator_confirmed', 'true', 'boolean',
    'تأیید اپراتور TTL', 'ادمین باید مقدار TTL واقعی Dashboard را تأیید کند')
  ON CONFLICT (section, key)
  DO UPDATE SET value = EXCLUDED.value;

  -- ── Verify after save ────────────────────────────────────────────────
  SELECT value INTO v_verify_ttl
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_seconds'
  LIMIT 1;

  SELECT value INTO v_verify_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed'
  LIMIT 1;

  IF v_verify_ttl IS NULL OR v_verify_ttl <> p_ttl_seconds::text OR v_verify_confirmed <> 'true' THEN
    RETURN QUERY SELECT false, 'SAVE_FAILED'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  -- ── Compute lock ────────────────────────────────────────────────────
  v_lock_seconds := GREATEST(p_ttl_seconds + 120, 300);

  RETURN QUERY SELECT true, NULL::text, p_ttl_seconds, v_lock_seconds;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_login_otp_ttl(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_login_otp_ttl(integer) TO authenticated;
