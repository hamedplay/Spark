-- ── phone_login_enabled config key ───────────────────────────────────────────
INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES (
  'security',
  'phone_login_enabled',
  'false',
  'boolean',
  'ورود با شماره موبایل',
  'امکان ورود کاربران با شماره موبایل و کد یک‌بارمصرف'
)
ON CONFLICT DO NOTHING;

-- ── phone_login_sms_provider_id config key ───────────────────────────────────
INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES (
  'sms',
  'phone_login_sms_provider_id',
  NULL,
  'string',
  'سرویس‌دهنده پیامک ورود موبایلی',
  'سرویس‌دهنده‌ای که برای ارسال کد یک‌بارمصرف ورود استفاده می‌شود'
)
ON CONFLICT DO NOTHING;

-- ── get_public_auth_config RPC ───────────────────────────────────────────────
-- Returns only public auth config: phone_login_enabled and phone_login_ready.
-- No credentials, no provider details, no secrets.
-- Accessible by anon (pre-auth) to determine if phone login is available.

CREATE OR REPLACE FUNCTION public.get_public_auth_config()
RETURNS TABLE (
  phone_login_enabled boolean,
  phone_login_ready boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
BEGIN
  -- Read phone_login_enabled
  SELECT (value = 'true') INTO v_enabled
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_enabled'
  LIMIT 1;

  -- Read selected provider ID
  SELECT value INTO v_provider_id
  FROM public.system_config
  WHERE section = 'sms' AND key = 'phone_login_sms_provider_id'
  LIMIT 1;

  -- Check if the selected provider is active
  IF v_provider_id IS NOT NULL THEN
    SELECT is_active INTO v_provider_active
    FROM public.sms_providers
    WHERE id = v_provider_id::uuid AND is_active = true
    LIMIT 1;
  END IF;

  -- Ready = enabled AND provider selected AND provider active
  RETURN QUERY SELECT
    v_enabled,
    v_enabled AND v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);
END;
$$;

-- Allow anon to call this RPC (pre-auth access)
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;

-- ── auth/login_otp notification template ─────────────────────────────────────
INSERT INTO public.notification_templates (category, event_type, audience, title, body, placeholders, is_active)
VALUES (
  'auth',
  'login_otp',
  'all',
  'کد ورود به سامانه اسپارک',
  'کد ورود شما به سامانه اسپارک: {{otp}}
این کد را در اختیار دیگران قرار ندهید.',
  ARRAY['{{otp}}']::text[],
  true
)
ON CONFLICT DO NOTHING;
