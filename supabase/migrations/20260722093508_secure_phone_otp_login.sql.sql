-- ═══════════════════════════════════════════════════════════════════════
-- Harden get_public_auth_config
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_public_auth_config()
RETURNS TABLE (
  phone_login_enabled boolean,
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

  RETURN QUERY SELECT
    v_enabled,
    v_enabled AND v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- set_phone_login_config — admin-only RPC
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_phone_login_config(
  p_enabled boolean,
  p_provider_id uuid
)
RETURNS TABLE (
  success boolean,
  error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin boolean := false;
  v_provider_active boolean := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN QUERY SELECT false, 'احراز هویت الزامی است'::text;
    RETURN;
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM public.profiles
  WHERE user_id = v_caller_id
  LIMIT 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN QUERY SELECT false, 'دسترسی مدیر الزامی است'::text;
    RETURN;
  END IF;

  IF p_enabled AND p_provider_id IS NOT NULL THEN
    SELECT is_active INTO v_provider_active
    FROM public.sms_providers
    WHERE id = p_provider_id
    LIMIT 1;

    IF v_provider_active IS NOT TRUE THEN
      RETURN QUERY SELECT false, 'سرویس‌دهنده انتخابی فعال نیست'::text;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.system_config (section, key, value, value_type, label, description)
  VALUES (
    'security', 'phone_login_enabled', COALESCE(p_enabled::text, 'false'), 'boolean',
    'ورود با شماره موبایل',
    'امکان ورود کاربران با شماره موبایل و کد یک‌بارمصرف'
  )
  ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.system_config (section, key, value, value_type, label, description)
  VALUES (
    'sms', 'phone_login_sms_provider_id', p_provider_id::text, 'string',
    'سرویس‌دهنده پیامک ورود موبایلی',
    'سرویس‌دهنده‌ای که برای ارسال کد یک‌بارمصرف ورود استفاده می‌شود'
  )
  ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value;

  RETURN QUERY SELECT true, NULL::text;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_login_config(boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_login_config(boolean, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Move OTP template to sms_templates (correct table)
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO public.sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
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

-- Remove the incorrectly-inserted template from notification_templates
DELETE FROM public.notification_templates
WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all';