-- ═══════════════════════════════════════════════════════════════════════
-- Finalize OTP TTL confirmation and profile uniqueness
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Fix TTL INSERT: use ON CONFLICT DO NOTHING (don't overwrite existing)
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES ('security', 'phone_login_otp_ttl_seconds', '3600', 'number', 'مدت اعتبار OTP موبایل (ثانیه)', 'TTL واقعی OTP از تنظیمات Supabase Auth. Lock = TTL + 120 ثانیه')
ON CONFLICT (section, key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Add phone_login_otp_ttl_operator_confirmed config (default false)
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES ('security', 'phone_login_otp_ttl_operator_confirmed', 'false', 'boolean', 'تأیید اپراتور TTL', 'ادمین باید مقدار TTL واقعی Dashboard را تأیید کند')
ON CONFLICT (section, key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Update set_phone_login_test_mode: strict duplicate profile checks
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
-- 4. Create set_phone_login_otp_ttl RPC (admin-only)
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

  -- ── Save TTL ────────────────────────────────────────────────────────
  UPDATE public.system_config
  SET value = p_ttl_seconds::text
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_seconds';

  -- ── Mark operator confirmed ─────────────────────────────────────────
  UPDATE public.system_config
  SET value = 'true'
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed';

  -- ── Compute lock ────────────────────────────────────────────────────
  v_lock_seconds := GREATEST(p_ttl_seconds + 120, 300);

  RETURN QUERY SELECT true, NULL::text, p_ttl_seconds, v_lock_seconds;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_login_otp_ttl(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_login_otp_ttl(integer) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Update reserve_auth_hook_event: check otp_ttl_operator_confirmed
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.reserve_auth_hook_event(text);

CREATE OR REPLACE FUNCTION public.reserve_auth_hook_event(p_webhook_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.auth_hook_events%ROWTYPE;
  v_ttl_text text := '';
  v_ttl_seconds integer := 0;
  v_lock_seconds integer := 0;
  v_ttl_confirmed boolean := false;
BEGIN
  -- Read OTP TTL from config
  SELECT value INTO v_ttl_text
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_seconds'
  LIMIT 1;

  -- Fail-closed if config missing or invalid
  IF v_ttl_text IS NULL OR v_ttl_text = '' THEN
    RETURN 'config_error';
  END IF;

  BEGIN
    v_ttl_seconds := v_ttl_text::integer;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'config_error';
  END;

  IF v_ttl_seconds <= 0 THEN
    RETURN 'config_error';
  END IF;

  -- Check operator confirmed
  SELECT (value = 'true') INTO v_ttl_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed'
  LIMIT 1;

  IF NOT COALESCE(v_ttl_confirmed, false) THEN
    RETURN 'config_error';
  END IF;

  -- lock = TTL + 120, minimum 300
  v_lock_seconds := GREATEST(v_ttl_seconds + 120, 300);

  BEGIN
    INSERT INTO public.auth_hook_events (webhook_id, status, locked_until, attempt_count)
    VALUES (p_webhook_id, 'processing', now() + make_interval(secs => v_lock_seconds), 1)
    ON CONFLICT (webhook_id) DO NOTHING
    RETURNING * INTO v_row;

    IF v_row.webhook_id IS NOT NULL THEN
      RETURN 'reserved';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE;
  END;

  SELECT * INTO v_row FROM public.auth_hook_events WHERE webhook_id = p_webhook_id FOR UPDATE;

  IF v_row.status IN ('sent', 'sent_unconfirmed') THEN
    RETURN 'already_sent';
  END IF;

  IF v_row.status = 'processing' AND v_row.locked_until > now() THEN
    RETURN 'locked';
  END IF;

  UPDATE public.auth_hook_events
  SET status = 'processing',
    locked_until = now() + make_interval(secs => v_lock_seconds),
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE webhook_id = p_webhook_id;

  RETURN 'retry_allowed';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Update get_public_auth_config: add otp_ttl_operator_confirmed,
--    make test_ready depend on it
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
    -- ready (public) = enabled AND provider_ready AND operator_confirmed AND e2e_verified
    v_enabled
      AND v_provider_ready
      AND COALESCE(v_operator_confirmed, false)
      AND COALESCE(v_e2e_verified, false),
    COALESCE(v_otp_ttl_confirmed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Update get_phone_login_admin_status: add otp_ttl fields
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_phone_login_admin_status();

CREATE OR REPLACE FUNCTION public.get_phone_login_admin_status()
RETURNS TABLE(
  test_mode boolean,
  test_phone_masked text,
  provider_ready boolean,
  operator_confirmed boolean,
  e2e_verified boolean,
  public_enabled boolean,
  otp_ttl_seconds integer,
  otp_ttl_operator_confirmed boolean,
  lock_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_test_mode boolean := false;
  v_test_phone text := '';
  v_masked text := '';
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_operator_confirmed boolean := false;
  v_e2e_verified boolean := false;
  v_enabled boolean := false;
  v_otp_ttl_text text := '';
  v_otp_ttl_seconds integer := 0;
  v_otp_ttl_confirmed boolean := false;
  v_lock_seconds integer := 0;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, false, false, false, NULL::integer, false, NULL::integer;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles
  WHERE user_id = v_caller_uid
  LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, NULL::text, false, false, false, false, NULL::integer, false, NULL::integer;
    RETURN;
  END IF;

  SELECT (value = 'true') INTO v_test_mode
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_test_mode'
  LIMIT 1;

  SELECT COALESCE(value, '') INTO v_test_phone
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_test_phone'
  LIMIT 1;

  -- Mask phone
  IF length(v_test_phone) >= 9 THEN
    v_masked := substring(v_test_phone, 1, 6) || '****' || substring(v_test_phone, length(v_test_phone) - 2);
  ELSIF length(v_test_phone) > 0 THEN
    v_masked := '****';
  ELSE
    v_masked := '';
  END IF;

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

  SELECT (value = 'true') INTO v_operator_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed'
  LIMIT 1;

  SELECT (value = 'true') INTO v_e2e_verified
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_e2e_verified'
  LIMIT 1;

  SELECT (value = 'true') INTO v_enabled
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_enabled'
  LIMIT 1;

  SELECT COALESCE(value, '') INTO v_otp_ttl_text
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_seconds'
  LIMIT 1;

  BEGIN
    v_otp_ttl_seconds := v_otp_ttl_text::integer;
  EXCEPTION WHEN OTHERS THEN
    v_otp_ttl_seconds := 0;
  END;

  SELECT (value = 'true') INTO v_otp_ttl_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed'
  LIMIT 1;

  IF v_otp_ttl_seconds > 0 THEN
    v_lock_seconds := GREATEST(v_otp_ttl_seconds + 120, 300);
  END IF;

  RETURN QUERY SELECT
    v_test_mode,
    v_masked,
    v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false),
    COALESCE(v_operator_confirmed, false),
    COALESCE(v_e2e_verified, false),
    v_enabled,
    CASE WHEN v_otp_ttl_seconds > 0 THEN v_otp_ttl_seconds ELSE NULL::integer END,
    COALESCE(v_otp_ttl_confirmed, false),
    CASE WHEN v_lock_seconds > 0 THEN v_lock_seconds ELSE NULL::integer END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_phone_login_admin_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_phone_login_admin_status() TO authenticated;
