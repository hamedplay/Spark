-- Align the Portal Config security controls with the canonical auth runtime.
-- 1) Browser-authenticated roles must never read or mutate security secret material.
-- 2) Enabling/disabling public phone OTP/recovery entry points is a security-admin
--    operation and requires a fresh, single-use TOTP step-up grant.

DROP POLICY IF EXISTS system_config_protect_security_secrets_select ON public.system_config;
CREATE POLICY system_config_protect_security_secrets_select
ON public.system_config
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  NOT (
    section = 'security'
    AND key = ANY (ARRAY[
      'phone_auth_pepper',
      'phone_rate_limit_pepper',
      'send_sms_hook_secret'
    ]::text[])
  )
);

DROP POLICY IF EXISTS system_config_protect_security_secrets_insert ON public.system_config;
CREATE POLICY system_config_protect_security_secrets_insert
ON public.system_config
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  NOT (
    section = 'security'
    AND key = ANY (ARRAY[
      'phone_auth_pepper',
      'phone_rate_limit_pepper',
      'send_sms_hook_secret'
    ]::text[])
  )
);

DROP POLICY IF EXISTS system_config_protect_security_secrets_update ON public.system_config;
CREATE POLICY system_config_protect_security_secrets_update
ON public.system_config
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  NOT (
    section = 'security'
    AND key = ANY (ARRAY[
      'phone_auth_pepper',
      'phone_rate_limit_pepper',
      'send_sms_hook_secret'
    ]::text[])
  )
)
WITH CHECK (
  NOT (
    section = 'security'
    AND key = ANY (ARRAY[
      'phone_auth_pepper',
      'phone_rate_limit_pepper',
      'send_sms_hook_secret'
    ]::text[])
  )
);

DROP POLICY IF EXISTS system_config_protect_security_secrets_delete ON public.system_config;
CREATE POLICY system_config_protect_security_secrets_delete
ON public.system_config
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  NOT (
    section = 'security'
    AND key = ANY (ARRAY[
      'phone_auth_pepper',
      'phone_rate_limit_pepper',
      'send_sms_hook_secret'
    ]::text[])
  )
);

CREATE OR REPLACE FUNCTION private.set_phone_auth_canonical_flags(
  p_login_enabled boolean DEFAULT NULL,
  p_recovery_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_grant_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF p_login_enabled IS NULL AND p_recovery_enabled IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_session_id := NULL;
  END;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.sessions s
    WHERE s.id = v_session_id
      AND s.user_id = v_uid
      AND (s.not_after IS NULL OR s.not_after > clock_timestamp())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF NOT private.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  SELECT g.id
  INTO v_grant_id
  FROM public.session_security_grants g
  WHERE g.user_id = v_uid
    AND g.session_id = v_session_id
    AND g.grant_type = 'mfa_stepup'
    AND g.purpose = 'auth_settings_change'
    AND g.factor_type = 'totp'
    AND g.assurance_level = 'aal2'
    AND g.revoked_at IS NULL
    AND g.consumed_at IS NULL
    AND g.expires_at > clock_timestamp()
  ORDER BY g.issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.session_security_grants
  SET consumed_at = clock_timestamp()
  WHERE id = v_grant_id;

  IF p_login_enabled IS NOT NULL THEN
    INSERT INTO public.system_config (
      section, key, value, value_type, description, updated_by, updated_at
    )
    VALUES (
      'security',
      'phone_login_canonical_enabled',
      p_login_enabled::text,
      'boolean',
      'Canonical feature flag for phone OTP login',
      v_uid,
      clock_timestamp()
    )
    ON CONFLICT (section, key) DO UPDATE
    SET value = EXCLUDED.value,
        value_type = EXCLUDED.value_type,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
  END IF;

  IF p_recovery_enabled IS NOT NULL THEN
    INSERT INTO public.system_config (
      section, key, value, value_type, description, updated_by, updated_at
    )
    VALUES (
      'security',
      'phone_password_recovery_canonical_enabled',
      p_recovery_enabled::text,
      'boolean',
      'Canonical feature flag for password recovery via phone OTP',
      v_uid,
      clock_timestamp()
    )
    ON CONFLICT (section, key) DO UPDATE
    SET value = EXCLUDED.value,
        value_type = EXCLUDED.value_type,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
  END IF;

  INSERT INTO public.security_audit_events (
    user_id,
    actor_user_id,
    event_type,
    event_category,
    severity,
    session_id,
    result,
    metadata
  )
  VALUES (
    v_uid,
    v_uid,
    'phone_auth_canonical_flags_changed',
    'settings_change',
    'warning',
    v_session_id,
    'success',
    jsonb_build_object(
      'login_enabled', p_login_enabled,
      'recovery_enabled', p_recovery_enabled
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Keep the public wrapper as the only client-visible entry point.
CREATE OR REPLACE FUNCTION public.set_phone_auth_canonical_flags(
  p_login_enabled boolean DEFAULT NULL,
  p_recovery_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT private.set_phone_auth_canonical_flags($1::boolean, $2::boolean)
$function$;
