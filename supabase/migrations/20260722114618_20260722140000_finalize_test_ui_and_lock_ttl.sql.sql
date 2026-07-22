-- ═══════════════════════════════════════════════════════════════════════
-- Finalize secure mobile OTP test UI
-- 1. Add phone_login_test_mode to public auth config output
-- 2. Create get_phone_login_admin_status() admin-gated RPC
-- 3. Update lock duration to OTP TTL + safety margin (12 minutes)
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Update get_public_auth_config: add phone_login_test_mode
-- ═══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_public_auth_config();

CREATE OR REPLACE FUNCTION public.get_public_auth_config()
RETURNS TABLE (
  phone_login_enabled boolean,
  provider_ready boolean,
  operator_confirmed boolean,
  e2e_verified boolean,
  phone_login_test_mode boolean,
  phone_login_test_ready boolean,
  phone_login_ready boolean
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
    EXCEPTION WHEN invalid_text_representation OR others THEN
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

  SELECT (value = 'true') INTO v_test_mode
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_test_mode'
  LIMIT 1;

  RETURN QUERY SELECT
    v_enabled,
    v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false),
    COALESCE(v_operator_confirmed, false),
    COALESCE(v_e2e_verified, false),
    COALESCE(v_test_mode, false),
    v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false)
      AND COALESCE(v_operator_confirmed, false),
    v_enabled
      AND v_provider_id IS NOT NULL
      AND COALESCE(v_provider_active, false)
      AND COALESCE(v_operator_confirmed, false)
      AND COALESCE(v_e2e_verified, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Admin-gated RPC: get_phone_login_admin_status
-- Returns masked test phone and all readiness flags
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_phone_login_admin_status()
RETURNS TABLE (
  test_mode boolean,
  test_phone_masked text,
  provider_ready boolean,
  operator_confirmed boolean,
  e2e_verified boolean,
  public_enabled boolean
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
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, false, false, false;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles
  WHERE user_id = v_caller_uid
  LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, NULL::text, false, false, false, false;
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

  -- Mask phone: show first 6 and last 3 digits
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

  RETURN QUERY SELECT
    v_test_mode,
    v_masked,
    v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false),
    COALESCE(v_operator_confirmed, false),
    COALESCE(v_e2e_verified, false),
    v_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.get_phone_login_admin_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_phone_login_admin_status() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Update lock duration to OTP TTL + safety margin
-- Supabase default OTP TTL = 10 minutes (600 seconds)
-- Lock = 12 minutes (OTP TTL + 2 minute safety margin)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reserve_auth_hook_event(p_webhook_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.auth_hook_events%ROWTYPE;
BEGIN
  BEGIN
    INSERT INTO public.auth_hook_events (webhook_id, status, locked_until, attempt_count)
    VALUES (p_webhook_id, 'processing', now() + interval '12 minutes', 1)
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
    locked_until = now() + interval '12 minutes',
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE webhook_id = p_webhook_id;

  RETURN 'retry_allowed';
END;
$$;
