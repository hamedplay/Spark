-- Keep the TOTP enrollment gate aligned with the runtime's per-user
-- mfa_enrollment_required override as well as the global MFA policy.

CREATE OR REPLACE FUNCTION public.get_mfa_policy_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_settings record;
  v_is_security_admin boolean := false;
  v_user_requires_mfa boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT
    mfa_policy,
    allow_totp_mfa,
    custom_mfa_enabled,
    custom_mfa_allowed_factors
  INTO v_settings
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  SELECT
    COALESCE(p.is_security_admin, false),
    COALESCE(p.mfa_enrollment_required, false)
  INTO v_is_security_admin, v_user_requires_mfa
  FROM public.profiles p
  WHERE p.user_id = v_uid
    AND p.is_active IS TRUE
    AND p.account_status = 'ACTIVE'
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'mfa_policy', COALESCE(v_settings.mfa_policy, 'disabled'),
    'allow_totp_mfa', COALESCE(v_settings.allow_totp_mfa, false),
    'user_mfa_enrollment_required', COALESCE(v_user_requires_mfa, false),
    'can_enroll_totp',
      COALESCE(v_is_security_admin, false)
      OR (
        COALESCE(v_settings.allow_totp_mfa, false)
        AND (
          COALESCE(v_settings.mfa_policy, 'disabled') <> 'disabled'
          OR COALESCE(v_user_requires_mfa, false)
        )
      ),
    'sms_mfa_enabled',
      COALESCE(v_settings.custom_mfa_enabled, false)
      AND 'sms' = ANY(COALESCE(v_settings.custom_mfa_allowed_factors, ARRAY[]::text[])),
    'supported_login_factors', jsonb_build_array('totp', 'sms')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_mfa_policy_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_mfa_policy_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_mfa_policy_state() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
