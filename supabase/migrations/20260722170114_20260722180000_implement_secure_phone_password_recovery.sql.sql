-- ═══════════════════════════════════════════════════════════════════════
-- Implement secure phone password recovery
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Add phone_password_recovery configs (both default false)
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES ('security', 'phone_password_recovery_enabled', 'false', 'boolean',
  'بازیابی رمز با موبایل', 'فعال‌سازی بازیابی رمز عبور از طریق شماره موبایل')
ON CONFLICT (section, key) DO NOTHING;

INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES ('security', 'phone_password_recovery_e2e_verified', 'false', 'boolean',
  'تست E2E بازیابی رمز', 'تست واقعی End-to-End بازیابی رمز موبایلی')
ON CONFLICT (section, key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Add 'phone_password_recovery' as a valid rate-limit purpose
--    (The rate limit table likely has a check constraint on purpose)
-- ═══════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Check if phone_otp_rate_limits table exists and has a purpose column with a constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'phone_otp_rate_limits' AND column_name = 'purpose'
  ) THEN
    -- Try to add the new purpose to the constraint if one exists
    BEGIN
      -- Drop and recreate constraint to include new purpose
      ALTER TABLE public.phone_otp_rate_limits DROP CONSTRAINT IF EXISTS phone_otp_rate_limits_purpose_check;
      ALTER TABLE public.phone_otp_rate_limits ADD CONSTRAINT phone_otp_rate_limits_purpose_check
        CHECK (purpose IN ('phone_login', 'phone_password_recovery'));
    EXCEPTION WHEN OTHERS THEN
      -- If constraint can't be altered, try without it
      NULL;
    END;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Create set_phone_password_recovery_config RPC (admin-only)
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.set_phone_password_recovery_config(boolean);

CREATE OR REPLACE FUNCTION public.set_phone_password_recovery_config(
  p_enabled boolean
)
RETURNS TABLE(success boolean, error text)
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
  v_ttl_text text := '';
  v_ttl_seconds integer := 0;
  v_e2e_verified boolean := false;
BEGIN
  -- ── Auth check ──────────────────────────────────────────────────────
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

  -- ── Disable path: always succeeds ───────────────────────────────────
  IF NOT p_enabled THEN
    UPDATE public.system_config SET value = 'false'
    WHERE section = 'security' AND key = 'phone_password_recovery_enabled';
    RETURN QUERY SELECT true, NULL::text;
    RETURN;
  END IF;

  -- ── Enable path: all gates must pass ────────────────────────────────

  -- Gate: provider ready
  SELECT value INTO v_provider_id
  FROM public.system_config
  WHERE section = 'sms' AND key = 'phone_login_sms_provider_id'
  LIMIT 1;

  IF v_provider_id IS NULL THEN
    RETURN QUERY SELECT false, 'PROVIDER_REQUIRED'::text;
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
    RETURN QUERY SELECT false, 'PROVIDER_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: hook operator confirmed
  SELECT (value = 'true') INTO v_operator_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed'
  LIMIT 1;

  IF NOT COALESCE(v_operator_confirmed, false) THEN
    RETURN QUERY SELECT false, 'HOOK_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate: TTL operator confirmed
  SELECT (value = 'true') INTO v_otp_ttl_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed'
  LIMIT 1;

  IF NOT COALESCE(v_otp_ttl_confirmed, false) THEN
    RETURN QUERY SELECT false, 'TTL_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate: TTL valid
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

  -- Gate: recovery E2E verified
  SELECT (value = 'true') INTO v_e2e_verified
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_password_recovery_e2e_verified'
  LIMIT 1;

  IF NOT COALESCE(v_e2e_verified, false) THEN
    RETURN QUERY SELECT false, 'E2E_NOT_VERIFIED'::text;
    RETURN;
  END IF;

  -- ── All gates passed ────────────────────────────────────────────────
  UPDATE public.system_config SET value = 'true'
  WHERE section = 'security' AND key = 'phone_password_recovery_enabled';

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_password_recovery_config(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_config(boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Update get_public_auth_config to include recovery readiness
-- ═══════════════════════════════════════════════════════════════════════
-- We add phone_password_recovery_ready as a new column
-- To avoid breaking existing callers, we recreate the function with the extra column

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
  phone_password_recovery_ready boolean
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
  v_recovery_enabled boolean := false;
  v_recovery_e2e boolean := false;
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

  SELECT (value = 'true') INTO v_recovery_enabled
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_password_recovery_enabled'
  LIMIT 1;

  SELECT (value = 'true') INTO v_recovery_e2e
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_password_recovery_e2e_verified'
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
    COALESCE(v_otp_ttl_confirmed, false),
    -- recovery_ready = recovery_enabled AND provider_ready AND operator_confirmed AND otp_ttl_confirmed AND recovery_e2e
    COALESCE(v_recovery_enabled, false)
      AND v_provider_ready
      AND COALESCE(v_operator_confirmed, false)
      AND COALESCE(v_otp_ttl_confirmed, false)
      AND COALESCE(v_recovery_e2e, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;
