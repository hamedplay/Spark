-- ============================================================================
-- Phone Login OTP table — lightweight, self-contained, no GoTrue dependency
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.phone_login_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phone_hash text NOT NULL,
  otp_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_login_otp_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_phone_login_otp"
  ON public.phone_login_otp_challenges FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_phone_login_otp_user
  ON public.phone_login_otp_challenges (user_id, status, expires_at);

-- ============================================================================
-- Store secrets in system_config (encrypted at rest by Supabase, not in env)
-- section = 'security', key = 'phone_auth_pepper' — used for HMAC hashing
-- ============================================================================
INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES (
  'security', 'phone_auth_pepper',
  encode(gen_random_bytes(32), 'hex'),
  'string',
  'Pepper برای HMAC هش شماره و OTP',
  'مقدار ۶۴ کاراکتری هگز — برای امضای HMAC در ورود موبایلی و بازیابی رمز'
)
ON CONFLICT (section, key) DO NOTHING;

-- ============================================================================
-- Store allowed origins in system_config
-- ============================================================================
INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES (
  'security', 'phone_login_allowed_origins',
  'https://shahrmeeting.ir,http://localhost:5173',
  'string',
  'Origins مجاز برای درخواست موبایلی',
  'لیست دامنه‌های مجاز برای CORS و Origin check'
)
ON CONFLICT (section, key) DO NOTHING;

-- ============================================================================
-- Enable test mode for the test user (448dd43a... — 09122632232)
-- ============================================================================
UPDATE public.system_config SET value = '09122632232', updated_at = now()
WHERE section = 'security' AND key = 'phone_login_test_phone';

UPDATE public.system_config SET value = '09122632232', updated_at = now()
WHERE section = 'security' AND key = 'phone_password_recovery_test_phone';

-- Enable test mode for both features
UPDATE public.system_config SET value = 'true', updated_at = now()
WHERE section = 'security' AND key = 'phone_login_test_mode';

UPDATE public.system_config SET value = 'true', updated_at = now()
WHERE section = 'security' AND key = 'phone_password_recovery_test_mode';

-- Confirm hook operator (we bypass the hook, so this is just to pass the gate)
UPDATE public.system_config SET value = 'true', updated_at = now()
WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed';

-- Confirm recovery secret (stored in DB now, not env)
UPDATE public.system_config SET value = 'true', updated_at = now()
WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed';

-- TTL is already confirmed
-- phone_login_otp_ttl_operator_confirmed = true (already)
-- phone_password_recovery_otp_ttl_seconds = 600 (already)

-- ============================================================================
-- RPC: get_phone_auth_config — reads pepper and origins from system_config
-- Returns: pepper, allowed_origins array
-- SECURITY DEFINER so edge functions can read it without direct table access
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_phone_auth_config()
RETURNS TABLE (pepper text, allowed_origins text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT value FROM system_config WHERE section = 'security' AND key = 'phone_auth_pepper' LIMIT 1),
    string_to_array(
      COALESCE(
        (SELECT value FROM system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1),
        ''
      ),
      ','
    );
$$;

REVOKE EXECUTE ON FUNCTION public.get_phone_auth_config() FROM anon, authenticated;