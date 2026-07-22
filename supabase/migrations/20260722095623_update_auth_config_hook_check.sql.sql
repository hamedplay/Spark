-- Update get_public_auth_config to also check hook secret status
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
  v_hook_secret_configured boolean := false;
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

  -- Check if auth hook secret is configured
  -- This checks for a config flag that indicates the hook has been set up
  SELECT (value = 'true') INTO v_hook_secret_configured
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_configured'
  LIMIT 1;

  -- Ready = enabled AND provider selected AND provider active AND hook secret configured
  RETURN QUERY SELECT
    v_enabled,
    v_enabled AND v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false) AND COALESCE(v_hook_secret_configured, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;
