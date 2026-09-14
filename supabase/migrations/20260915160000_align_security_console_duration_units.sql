-- Keep the security console RPC aligned with the canonical duration units.
-- In particular, progressive_lock_schedule is now stored and interpreted in minutes.

CREATE OR REPLACE FUNCTION private.get_auth_security_console_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_session_exists boolean := false;
  v_settings public.auth_security_settings%ROWTYPE;
  v_is_security_admin boolean := false;
  v_active_users int;
  v_users_with_totp int;
  v_users_without_totp int;
  v_security_admins int;
  v_security_admins_without_totp int;
  v_history jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;
  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT is_security_admin INTO v_is_security_admin
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;
  IF NOT COALESCE(v_is_security_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  SELECT * INTO v_settings FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  SELECT COUNT(*) INTO v_active_users
  FROM public.profiles
  WHERE is_active = true;

  SELECT COUNT(*) INTO v_users_with_totp
  FROM public.profiles p
  WHERE p.is_active = true
    AND EXISTS (
      SELECT 1
      FROM auth.mfa_factors f
      WHERE f.user_id = p.user_id
        AND f.factor_type = 'totp'
        AND f.status = 'verified'
    );

  v_users_without_totp := GREATEST(v_active_users - v_users_with_totp, 0);

  SELECT COUNT(*) INTO v_security_admins
  FROM public.profiles
  WHERE is_security_admin = true;

  SELECT COUNT(*) INTO v_security_admins_without_totp
  FROM public.profiles p
  WHERE p.is_security_admin = true
    AND NOT EXISTS (
      SELECT 1
      FROM auth.mfa_factors f
      WHERE f.user_id = p.user_id
        AND f.factor_type = 'totp'
        AND f.status = 'verified'
    );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'version', h.version,
        'changed_at', h.changed_at,
        'change_reason', h.change_reason,
        'changed_by', h.changed_by,
        'mfa_policy', h.mfa_policy,
        'allow_totp_mfa', h.allow_totp_mfa,
        'username_login', h.username_login,
        'email_login', h.email_login,
        'phone_login', h.phone_login
      ) ORDER BY h.version DESC
    ),
    '[]'::jsonb
  )
  INTO v_history
  FROM (
    SELECT *
    FROM public.auth_security_settings_history
    ORDER BY version DESC
    LIMIT 20
  ) h;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', jsonb_build_object(
      'settings_version', v_settings.settings_version,
      'username_login', v_settings.username_login,
      'email_login', v_settings.email_login,
      'phone_login', v_settings.phone_login,
      'mfa_policy', v_settings.mfa_policy,
      'registration_enabled', v_settings.registration_enabled,
      'registration_requires_admin_approval', v_settings.registration_requires_admin_approval,
      'require_profile_completion', v_settings.require_profile_completion,
      'allow_totp_mfa', v_settings.allow_totp_mfa,
      'allow_bale_mfa', v_settings.allow_bale_mfa,
      'allow_email_mfa', v_settings.allow_email_mfa,
      'allow_recovery_codes', v_settings.allow_recovery_codes,
      'session_idle_timeout_minutes', v_settings.session_idle_timeout_minutes,
      'session_absolute_lifetime_minutes', v_settings.session_absolute_lifetime_minutes,
      'max_active_sessions', v_settings.max_active_sessions,
      'session_management_enabled', COALESCE(v_settings.session_management_enabled, false),
      'session_heartbeat_interval_seconds', COALESCE(v_settings.session_heartbeat_interval_seconds, 300),
      'lock_threshold', v_settings.lock_threshold,
      'lock_duration_minutes', v_settings.lock_duration_minutes,
      'progressive_lock_enabled', COALESCE(v_settings.progressive_lock_enabled, false),
      'progressive_lock_schedule', COALESCE(v_settings.progressive_lock_schedule, ARRAY['60','360','720','1440','2880','4320']::text[]),
      'recovery_enabled', v_settings.recovery_enabled,
      'unified_recovery_enabled', COALESCE(v_settings.unified_recovery_enabled, false),
      'recovery_otp_ttl_seconds', COALESCE(v_settings.recovery_otp_ttl_seconds, 600),
      'recovery_max_attempts', COALESCE(v_settings.recovery_max_attempts, 5),
      'recovery_reset_token_ttl_seconds', COALESCE(v_settings.recovery_reset_token_ttl_seconds, 300),
      'config_schema_version', v_settings.config_schema_version,
      'updated_at', v_settings.updated_at,
      'custom_mfa_enabled', v_settings.custom_mfa_enabled,
      'custom_mfa_required', v_settings.custom_mfa_required,
      'custom_mfa_allowed_factors', v_settings.custom_mfa_allowed_factors,
      'custom_mfa_challenge_ttl_seconds', v_settings.custom_mfa_challenge_ttl_seconds,
      'custom_mfa_max_resends', v_settings.custom_mfa_max_resends,
      'custom_mfa_max_attempts', v_settings.custom_mfa_max_attempts,
      'custom_mfa_grant_lifetime_minutes', v_settings.custom_mfa_grant_lifetime_minutes
    ),
    'impact', jsonb_build_object(
      'active_users', v_active_users,
      'users_with_verified_totp', v_users_with_totp,
      'users_without_verified_totp', v_users_without_totp,
      'security_admins', v_security_admins,
      'security_admins_without_verified_totp', v_security_admins_without_totp
    ),
    'recent_history', v_history
  );
END;
$function$;
