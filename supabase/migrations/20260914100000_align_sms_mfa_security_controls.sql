-- The current canonical MFA runtime supports TOTP and SMS as account methods.
-- The custom-mfa Edge Function accepts login challenges only for SMS.  Guard
-- the generic security setter so the admin console cannot create a state that
-- strands users who already use SMS MFA or advertises unsupported factors.

CREATE OR REPLACE FUNCTION public.set_auth_security_settings_patch(
  p_expected_version integer,
  p_patch jsonb,
  p_change_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_current public.auth_security_settings%ROWTYPE;
  v_effective_enabled boolean;
  v_effective_factors text[];
  v_requested_required boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF NOT private.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN private.set_auth_security_settings_patch(
      p_expected_version,
      p_patch,
      p_change_reason
    );
  END IF;

  SELECT *
  INTO v_current
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  v_effective_enabled := COALESCE(v_current.custom_mfa_enabled, false);
  v_effective_factors := COALESCE(v_current.custom_mfa_allowed_factors, ARRAY[]::text[]);

  IF p_patch ? 'custom_mfa_enabled' THEN
    IF jsonb_typeof(p_patch -> 'custom_mfa_enabled') <> 'boolean' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', 'custom_mfa_enabled');
    END IF;
    v_effective_enabled := (p_patch ->> 'custom_mfa_enabled')::boolean;
  END IF;

  IF p_patch ? 'custom_mfa_allowed_factors' THEN
    IF jsonb_typeof(p_patch -> 'custom_mfa_allowed_factors') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', 'custom_mfa_allowed_factors');
    END IF;
    v_effective_factors := ARRAY(
      SELECT jsonb_array_elements_text(p_patch -> 'custom_mfa_allowed_factors')
    );

    IF EXISTS (
      SELECT 1
      FROM unnest(v_effective_factors) AS factor
      WHERE factor <> 'sms'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CUSTOM_MFA_FACTOR_UNSUPPORTED');
    END IF;
  END IF;

  IF p_patch ? 'custom_mfa_required' THEN
    IF jsonb_typeof(p_patch -> 'custom_mfa_required') <> 'boolean' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', 'custom_mfa_required');
    END IF;
    v_requested_required := (p_patch ->> 'custom_mfa_required')::boolean;
    IF v_requested_required THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CUSTOM_MFA_REQUIRED_UNSUPPORTED');
    END IF;
  END IF;

  IF v_effective_enabled
     AND NOT ('sms' = ANY(COALESCE(v_effective_factors, ARRAY[]::text[]))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SMS_MFA_FACTOR_REQUIRED');
  END IF;

  IF v_effective_enabled
     AND NOT EXISTS (
       SELECT 1
       FROM public.sms_providers sp
       WHERE sp.is_active IS TRUE
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SMS_MFA_NOT_READY');
  END IF;

  IF (
       NOT v_effective_enabled
       OR NOT ('sms' = ANY(COALESCE(v_effective_factors, ARRAY[]::text[])))
     )
     AND EXISTS (
       SELECT 1
       FROM public.profiles p
       WHERE p.mfa_method = 'sms'
         AND p.is_active IS TRUE
         AND p.account_status = 'ACTIVE'
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACTIVE_SMS_MFA_USERS');
  END IF;

  RETURN private.set_auth_security_settings_patch(
    p_expected_version,
    p_patch,
    p_change_reason
  );
END;
$function$;
