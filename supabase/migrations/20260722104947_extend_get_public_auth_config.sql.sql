-- Drop old version first (return type changed)
DROP FUNCTION IF EXISTS public.get_public_auth_config();

-- Extend get_public_auth_config with granular readiness fields
-- Returns: phone_login_enabled, provider_ready, operator_confirmed, e2e_verified, phone_login_ready
-- Formula: phone_login_ready = enabled AND provider_ready AND operator_confirmed AND e2e_verified

CREATE OR REPLACE FUNCTION public.get_public_auth_config()
RETURNS TABLE (
  phone_login_enabled boolean,
  provider_ready boolean,
  operator_confirmed boolean,
  e2e_verified boolean,
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

  RETURN QUERY SELECT
    v_enabled,
    v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false),
    COALESCE(v_operator_confirmed, false),
    COALESCE(v_e2e_verified, false),
    v_enabled
      AND v_provider_id IS NOT NULL
      AND COALESCE(v_provider_active, false)
      AND COALESCE(v_operator_confirmed, false)
      AND COALESCE(v_e2e_verified, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;
