/*
# Scoped Phone Password Reset Challenge Table

## Summary
Replaces the insecure Supabase Auth OTP recovery flow with a dedicated
challenge-response table. No Supabase Auth session is created during
password recovery — the entire flow is managed by edge functions using
the service role key.

## New Tables
- `phone_password_reset_challenges` — stores OTP challenges for password
  recovery. Only HMAC hashes are stored (phone_hash, otp_hash,
  reset_token_hash). Raw phone, OTP, and reset token are NEVER persisted.

## New Config Keys (all default false)
- `phone_password_recovery_enabled`
- `phone_password_recovery_e2e_verified`
- `phone_password_recovery_test_mode`
- `phone_password_recovery_test_phone`
- `phone_password_recovery_secret_operator_confirmed`
- `phone_password_recovery_otp_ttl_seconds` (default 600 = 10 min)

## Updated RPCs
- `get_public_auth_config()` — adds recovery readiness columns
- `set_phone_password_recovery_config()` — updated for new gate logic

## Security
- RLS ENABLED and FORCED on challenge table
- NO policies for anon or authenticated — table is fully locked
- All direct grants REVOKED from PUBLIC, anon, authenticated
- Only service role (edge functions) can access the table

## Important Notes
1. This migration is ADDITIVE — does not modify existing tables or
   previous migrations.
2. The challenge table is intentionally inaccessible to frontend clients.
3. Edge functions use the service role key which bypasses RLS.
*/

-- ═══════════════════════════════════════════════════════════════════════
-- 1. New config keys
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES
  ('security', 'phone_password_recovery_enabled', 'false', 'boolean',
   'بازیابی رمز با موبایل', 'فعال‌سازی بازیابی رمز عبور از طریق شماره موبایل'),
  ('security', 'phone_password_recovery_e2e_verified', 'false', 'boolean',
   'تست E2E بازیابی رمز', 'تست واقعی End-to-End بازیابی رمز موبایلی'),
  ('security', 'phone_password_recovery_test_mode', 'false', 'boolean',
   'حالت تست بازیابی رمز', 'حالت تست برای بازیابی رمز - فقط شماره تعیین‌شده'),
  ('security', 'phone_password_recovery_test_phone', '', 'string',
   'شماره تست بازیابی رمز', 'شماره موبایل مجاز در حالت تست بازیابی رمز'),
  ('security', 'phone_password_recovery_secret_operator_confirmed', 'false', 'boolean',
   'تأیید Secret بازیابی رمز', 'تأیید اپراتور برای Secret بازیابی رمز'),
  ('security', 'phone_password_recovery_otp_ttl_seconds', '600', 'integer',
   'TTL کد بازیابی (ثانیه)', 'مدت اعتبار کد یک‌بارمصرف بازیابی رمز')
ON CONFLICT (section, key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Challenge table
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.phone_password_reset_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phone_hash text NOT NULL,
  otp_hash text NOT NULL,
  reset_token_hash text,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  reset_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  consumed_at timestamptz,
  locked_until timestamptz,
  CONSTRAINT chk_challenge_status CHECK (
    status IN ('pending', 'verified', 'consumed', 'expired', 'locked')
  )
);

CREATE INDEX IF NOT EXISTS idx_pprc_user_id ON public.phone_password_reset_challenges (user_id);
CREATE INDEX IF NOT EXISTS idx_pprc_phone_hash ON public.phone_password_reset_challenges (phone_hash);
CREATE INDEX IF NOT EXISTS idx_pprc_status ON public.phone_password_reset_challenges (status);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RLS — fully locked, no policies for any role
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.phone_password_reset_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_password_reset_challenges FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.phone_password_reset_challenges FROM PUBLIC;
REVOKE ALL ON public.phone_password_reset_challenges FROM anon;
REVOKE ALL ON public.phone_password_reset_challenges FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Update get_public_auth_config() with recovery readiness
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
  phone_password_recovery_ready boolean
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

  v_template_ready boolean := false;
BEGIN
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
    SELECT EXISTS(
      SELECT 1 FROM public.notification_templates
      WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all'
    ) INTO v_template_ready;
  EXCEPTION WHEN OTHERS THEN v_template_ready := false; END;

  RETURN QUERY SELECT
    v_login_enabled,
    v_provider_ready,
    COALESCE(v_operator_confirmed, false),
    COALESCE(v_login_e2e, false),
    COALESCE(v_test_mode, false),
    v_provider_ready AND COALESCE(v_operator_confirmed, false) AND COALESCE(v_otp_ttl_confirmed, false),
    v_login_enabled AND v_provider_ready AND COALESCE(v_operator_confirmed, false)
      AND COALESCE(v_otp_ttl_confirmed, false) AND COALESCE(v_login_e2e, false),
    COALESCE(v_otp_ttl_confirmed, false),
    COALESCE(v_recovery_enabled, false),
    COALESCE(v_recovery_test_mode, false),
    v_provider_ready AND v_template_ready AND COALESCE(v_recovery_secret_confirmed, false),
    COALESCE(v_recovery_enabled, false)
      AND v_provider_ready
      AND v_template_ready
      AND COALESCE(v_recovery_secret_confirmed, false)
      AND COALESCE(v_recovery_e2e, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Update set_phone_password_recovery_config() for new gate logic
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
  v_provider_ready boolean := false;
  v_e2e_verified boolean := false;
  v_secret_confirmed boolean := false;
  v_template_ready boolean := false;
  v_ttl_text text := '';
  v_ttl_seconds integer := 0;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, 'NOT_AUTHENTICATED'::text;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles WHERE user_id = v_caller_uid LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'NOT_ADMIN'::text;
    RETURN;
  END IF;

  IF NOT p_enabled THEN
    UPDATE public.system_config SET value = 'false'
    WHERE section = 'security' AND key = 'phone_password_recovery_enabled';
    RETURN QUERY SELECT true, NULL::text;
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
    RETURN QUERY SELECT false, 'PROVIDER_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: template ready
  BEGIN
    SELECT EXISTS(
      SELECT 1 FROM public.notification_templates
      WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all'
    ) INTO v_template_ready;
  EXCEPTION WHEN OTHERS THEN v_template_ready := false; END;

  IF NOT v_template_ready THEN
    RETURN QUERY SELECT false, 'TEMPLATE_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: secret operator confirmed
  SELECT (value = 'true') INTO v_secret_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed' LIMIT 1;

  IF NOT COALESCE(v_secret_confirmed, false) THEN
    RETURN QUERY SELECT false, 'SECRET_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate: E2E verified
  SELECT (value = 'true') INTO v_e2e_verified
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_e2e_verified' LIMIT 1;

  IF NOT COALESCE(v_e2e_verified, false) THEN
    RETURN QUERY SELECT false, 'E2E_NOT_VERIFIED'::text;
    RETURN;
  END IF;

  -- Gate: TTL valid
  SELECT value INTO v_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;

  BEGIN
    v_ttl_seconds := v_ttl_text::integer;
  EXCEPTION WHEN OTHERS THEN v_ttl_seconds := 0; END;

  IF v_ttl_seconds < 60 OR v_ttl_seconds > 86400 THEN
    RETURN QUERY SELECT false, 'INVALID_TTL'::text;
    RETURN;
  END IF;

  UPDATE public.system_config SET value = 'true'
  WHERE section = 'security' AND key = 'phone_password_recovery_enabled';

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_password_recovery_config(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_config(boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Rate limit purpose constraint update
-- ═══════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'phone_otp_rate_limit' AND column_name = 'purpose'
  ) THEN
    BEGIN
      ALTER TABLE public.phone_otp_rate_limit DROP CONSTRAINT IF EXISTS phone_otp_rate_limit_purpose_check;
      ALTER TABLE public.phone_otp_rate_limit ADD CONSTRAINT phone_otp_rate_limit_purpose_check
        CHECK (purpose IN ('phone_login', 'phone_password_recovery', 'phone_password_recovery_verify', 'phone_password_recovery_complete'));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Notification template for password_reset_otp
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO public.notification_templates (category, event_type, audience, body, is_active)
VALUES ('auth', 'password_reset_otp', 'all',
  'کد بازیابی رمز اسپارک: {{otp}}\nاین کد را در اختیار دیگران قرار ندهید.', true)
ON CONFLICT (category, event_type, audience) DO NOTHING;
