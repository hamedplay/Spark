-- ═══════════════════════════════════════════════════════════════════════
-- Fix OTP readiness, audit masking and TTL
-- 1. Add phone_login_otp_ttl_seconds config (3600 = Supabase hosted default)
-- 2. Update set_phone_login_test_mode to return test_phone_masked
-- 3. Update reserve_auth_hook_event to use dynamic lock from config
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Add phone_login_otp_ttl_seconds config
--    Supabase hosted default OTP TTL = 3600 seconds (60 minutes)
--    Lock = TTL + 120 seconds safety margin = 3720 seconds (62 minutes)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES ('security', 'phone_login_otp_ttl_seconds', '3600', 'number', 'مدت اعتبار OTP موبایل (ثانیه)', 'TTL واقعی OTP از تنظیمات Supabase Auth. Lock = TTL + 120 ثانیه')
ON CONFLICT (section, key) DO UPDATE SET value = '3600', value_type = 'number', label = 'مدت اعتبار OTP موبایل (ثانیه)', description = 'TTL واقعی OTP از تنظیمات Supabase Auth. Lock = TTL + 120 ثانیه';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Update set_phone_login_test_mode: return test_phone_masked
--    Masking happens server-side after normalize
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
  v_normalized_phone text := '';
  v_profile_count integer := 0;
  v_auth_phone text := '';
  v_auth_phone_count integer := 0;
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

    -- Normalize and validate test phone
    v_normalized_phone := public.normalize_iran_phone(p_test_phone);
    IF v_normalized_phone = '' THEN
      RETURN QUERY SELECT false, 'INVALID_PHONE'::text, false, NULL::text;
      RETURN;
    END IF;

    -- Check test phone belongs to an active profile
    SELECT count(*) INTO v_profile_count
    FROM public.profiles
    WHERE phone IS NOT NULL AND phone != ''
    AND public.normalize_iran_phone(phone) = v_normalized_phone
    AND COALESCE(is_active, false) = true
    LIMIT 1;

    IF v_profile_count = 0 THEN
      RETURN QUERY SELECT false, 'PHONE_NOT_IN_ACTIVE_PROFILE'::text, false, NULL::text;
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

    -- Check auth.users phone belongs to the same profile user
    SELECT u.phone INTO v_auth_phone
    FROM auth.users u
    WHERE u.phone = '+' || v_normalized_phone OR u.phone = v_normalized_phone
    LIMIT 1;

    SELECT count(*) INTO v_profile_count
    FROM public.profiles p
    JOIN auth.users u ON p.user_id = u.id
    WHERE (u.phone = '+' || v_normalized_phone OR u.phone = v_normalized_phone)
    AND public.normalize_iran_phone(p.phone) = v_normalized_phone
    AND COALESCE(p.is_active, false) = true;

    IF v_profile_count = 0 THEN
      RETURN QUERY SELECT false, 'AUTH_PROFILE_MISMATCH'::text, false, NULL::text;
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
-- 3. Update reserve_auth_hook_event: dynamic lock from config
--    lock_seconds = GREATEST(ttl + 120, 300)
--    If config missing/invalid → fail-closed (return 'config_error')
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
