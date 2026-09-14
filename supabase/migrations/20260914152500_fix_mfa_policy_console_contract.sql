-- Fix the MFA policy console contract without weakening the TOTP step-up model.
-- 1) session_security_grants has no revoked_at column; consumed_at is the grant lifecycle marker.
-- 2) expose a minimal authenticated MFA-policy state used by the enrollment UI.

DO $repair$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  SELECT p.oid
  INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'set_auth_security_settings_patch'
    AND pg_get_function_identity_arguments(p.oid) = 'p_expected_version integer, p_patch jsonb, p_change_reason text'
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'private.set_auth_security_settings_patch(integer,jsonb,text) not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF position('revoked_at' IN v_def) > 0 THEN
    v_def := regexp_replace(
      v_def,
      E'\\n[[:space:]]*AND revoked_at IS NULL[[:space:]]*\\n[[:space:]]*AND consumed_at IS NULL',
      E'\n    AND factor_type = ''totp''\n    AND assurance_level = ''aal2''\n    AND consumed_at IS NULL',
      'g'
    );

    IF position('revoked_at' IN v_def) > 0 THEN
      RAISE EXCEPTION 'failed to remove stale revoked_at reference from private.set_auth_security_settings_patch';
    END IF;

    EXECUTE v_def;
  END IF;
END;
$repair$;

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

  SELECT COALESCE(p.is_security_admin, false)
  INTO v_is_security_admin
  FROM public.profiles p
  WHERE p.user_id = v_uid
    AND p.is_active IS TRUE
    AND p.account_status = 'ACTIVE'
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'mfa_policy', COALESCE(v_settings.mfa_policy, 'disabled'),
    'allow_totp_mfa', COALESCE(v_settings.allow_totp_mfa, false),
    'can_enroll_totp',
      COALESCE(v_is_security_admin, false)
      OR (
        COALESCE(v_settings.allow_totp_mfa, false)
        AND COALESCE(v_settings.mfa_policy, 'disabled') <> 'disabled'
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
