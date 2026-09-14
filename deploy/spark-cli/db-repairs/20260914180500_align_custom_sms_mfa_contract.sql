-- Production compatibility repair for the SMS-only custom MFA contract.

UPDATE public.auth_security_settings
SET
  custom_mfa_required = false,
  custom_mfa_allowed_factors = CASE
    WHEN COALESCE(custom_mfa_enabled, false) THEN ARRAY['sms']::text[]
    ELSE ARRAY[]::text[]
  END
WHERE id = 1
  AND (
    COALESCE(custom_mfa_required, false)
    OR COALESCE(custom_mfa_allowed_factors, ARRAY[]::text[]) IS DISTINCT FROM
       CASE
         WHEN COALESCE(custom_mfa_enabled, false) THEN ARRAY['sms']::text[]
         ELSE ARRAY[]::text[]
       END
  );

ALTER TABLE public.auth_security_settings
  DROP CONSTRAINT IF EXISTS auth_security_settings_custom_mfa_sms_only_chk;

ALTER TABLE public.auth_security_settings
  ADD CONSTRAINT auth_security_settings_custom_mfa_sms_only_chk
  CHECK (
    COALESCE(custom_mfa_required, false) = false
    AND COALESCE(custom_mfa_allowed_factors, ARRAY[]::text[]) <@ ARRAY['sms']::text[]
    AND (
      NOT COALESCE(custom_mfa_enabled, false)
      OR 'sms' = ANY(COALESCE(custom_mfa_allowed_factors, ARRAY[]::text[]))
    )
  );

CREATE OR REPLACE FUNCTION public.get_custom_mfa_readiness()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sms_ready boolean := false;
  v_allowed text[] := ARRAY[]::text[];
  v_enabled boolean := false;
BEGIN
  SELECT
    COALESCE(custom_mfa_enabled, false),
    COALESCE(custom_mfa_allowed_factors, ARRAY[]::text[])
  INTO v_enabled, v_allowed
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND', 'readiness', 'not_ready');
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.sms_providers sp
    WHERE sp.is_active IS TRUE
  ) INTO v_sms_ready;

  RETURN jsonb_build_object(
    'ok', true,
    'mfa_enabled', v_enabled,
    'mfa_required', false,
    'allowed_factors', v_allowed,
    'supported_factors', jsonb_build_array('sms'),
    'sms_ready', v_sms_ready,
    'readiness', CASE
      WHEN NOT v_enabled THEN 'disabled'
      WHEN v_allowed <> ARRAY['sms']::text[] THEN 'misconfigured'
      WHEN NOT v_sms_ready THEN 'not_ready'
      ELSE 'ready'
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_custom_mfa_readiness() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_custom_mfa_readiness() FROM anon;
REVOKE ALL ON FUNCTION public.get_custom_mfa_readiness() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_custom_mfa_readiness() TO service_role;

NOTIFY pgrst, 'reload schema';
