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
      'progressive_lock_schedule', COALESCE(v_settings.progressive_lock_schedule, ARRAY['1','6','12','24','48','72']::text[]),
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

CREATE OR REPLACE FUNCTION private.set_auth_security_settings_patch(
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
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_is_security_admin boolean := false;
  v_current public.auth_security_settings%ROWTYPE;
  v_new public.auth_security_settings%ROWTYPE;
  v_new_version integer;
  v_stepup_grant public.session_security_grants%ROWTYPE;
  v_session_exists boolean := false;
  v_before_state jsonb;
  v_after_state jsonb;
  v_key text;
  v_value jsonb;
  v_allowed_keys text[] := ARRAY[
    'username_login', 'email_login', 'phone_login', 'mfa_policy',
    'registration_enabled', 'registration_requires_admin_approval', 'require_profile_completion',
    'allow_totp_mfa', 'allow_bale_mfa', 'allow_email_mfa', 'allow_recovery_codes',
    'session_idle_timeout_minutes', 'session_absolute_lifetime_minutes', 'max_active_sessions',
    'session_management_enabled', 'session_heartbeat_interval_seconds',
    'lock_threshold', 'lock_duration_minutes', 'progressive_lock_enabled', 'progressive_lock_schedule',
    'recovery_enabled', 'unified_recovery_enabled', 'recovery_otp_ttl_seconds',
    'recovery_max_attempts', 'recovery_reset_token_ttl_seconds',
    'custom_mfa_enabled', 'custom_mfa_required', 'custom_mfa_allowed_factors',
    'custom_mfa_challenge_ttl_seconds', 'custom_mfa_max_resends',
    'custom_mfa_max_attempts', 'custom_mfa_grant_lifetime_minutes'
  ];
  v_int_val integer;
  v_text_val text;
  v_reason text;
  v_changed_keys jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE');
  END IF;

  v_reason := trim(COALESCE(p_change_reason, ''));
  IF length(v_reason) < 10 OR length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CHANGE_REASON');
  END IF;

  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
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

  SELECT * INTO v_stepup_grant
  FROM public.session_security_grants
  WHERE user_id = v_uid
    AND session_id = v_session_id
    AND grant_type = 'mfa_stepup'
    AND purpose = 'auth_settings_change'
    AND revoked_at IS NULL
    AND consumed_at IS NULL
    AND expires_at > now()
  ORDER BY issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  SELECT * INTO v_current
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  IF v_current.settings_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'VERSION_CONFLICT',
      'current_version', v_current.settings_version
    );
  END IF;

  v_new := v_current;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY', 'key', v_key);
    END IF;

    IF v_key IN (
      'username_login','email_login','phone_login','registration_enabled',
      'registration_requires_admin_approval','require_profile_completion',
      'allow_totp_mfa','allow_bale_mfa','allow_email_mfa','allow_recovery_codes',
      'session_management_enabled','progressive_lock_enabled','recovery_enabled',
      'unified_recovery_enabled','custom_mfa_enabled','custom_mfa_required'
    ) THEN
      IF jsonb_typeof(v_value) <> 'boolean' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
      END IF;
      v_new := jsonb_populate_record(v_new, jsonb_build_object(v_key, v_value));

    ELSIF v_key IN (
      'session_idle_timeout_minutes','session_absolute_lifetime_minutes','max_active_sessions',
      'session_heartbeat_interval_seconds','lock_threshold','lock_duration_minutes',
      'recovery_otp_ttl_seconds','recovery_max_attempts','recovery_reset_token_ttl_seconds',
      'custom_mfa_challenge_ttl_seconds','custom_mfa_max_resends',
      'custom_mfa_max_attempts','custom_mfa_grant_lifetime_minutes'
    ) THEN
      IF jsonb_typeof(v_value) <> 'number' OR v_value::text !~ '^-?[0-9]+$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
      END IF;
      v_int_val := v_value::text::integer;
      v_new := jsonb_populate_record(v_new, jsonb_build_object(v_key, v_int_val));

    ELSIF v_key = 'mfa_policy' THEN
      IF jsonb_typeof(v_value) <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
      END IF;
      v_text_val := v_value #>> '{}';
      IF v_text_val NOT IN ('disabled','optional','required') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
      END IF;
      v_new := jsonb_populate_record(v_new, jsonb_build_object(v_key, v_text_val));

    ELSIF v_key IN ('custom_mfa_allowed_factors','progressive_lock_schedule') THEN
      IF jsonb_typeof(v_value) <> 'array' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
      END IF;
      v_new := jsonb_populate_record(
        v_new,
        jsonb_build_object(v_key, ARRAY(SELECT jsonb_array_elements_text(v_value)))
      );
    END IF;
  END LOOP;

  IF NOT v_new.username_login AND NOT v_new.email_login AND NOT v_new.phone_login THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LOGIN_METHOD_ENABLED');
  END IF;

  IF v_new.mfa_policy = 'required' AND NOT v_new.allow_totp_mfa THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_REQUIRED_WITHOUT_FACTOR');
  END IF;

  IF v_new.custom_mfa_required AND NOT v_new.custom_mfa_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_REQUIRED_WITHOUT_FACTOR');
  END IF;

  IF v_new.custom_mfa_required AND COALESCE(array_length(v_new.custom_mfa_allowed_factors, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_REQUIRED_WITHOUT_FACTOR');
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_new.custom_mfa_allowed_factors, ARRAY[]::text[])) AS factor
    WHERE NOT (factor = ANY(ARRAY['totp','sms','bale','email','recovery']::text[]))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;

  IF v_new.session_idle_timeout_minutes > v_new.session_absolute_lifetime_minutes THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION_POLICY');
  END IF;
  IF v_new.session_idle_timeout_minutes < 1 OR v_new.session_idle_timeout_minutes > 10080 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.session_absolute_lifetime_minutes < 1 OR v_new.session_absolute_lifetime_minutes > 43200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.max_active_sessions < 1 OR v_new.max_active_sessions > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.session_heartbeat_interval_seconds < 30 OR v_new.session_heartbeat_interval_seconds > 3600 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.lock_threshold < 1 OR v_new.lock_threshold > 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.lock_duration_minutes < 1 OR v_new.lock_duration_minutes > 1440 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;

  IF COALESCE(array_length(v_new.progressive_lock_schedule, 1), 0) < 1
     OR COALESCE(array_length(v_new.progressive_lock_schedule, 1), 0) > 12
     OR EXISTS (
       SELECT 1
       FROM unnest(COALESCE(v_new.progressive_lock_schedule, ARRAY[]::text[])) AS entry
       WHERE CASE
         WHEN entry ~ '^[0-9]+$' THEN entry::integer < 1 OR entry::integer > 720
         ELSE true
       END
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;

  IF v_new.recovery_otp_ttl_seconds < 60 OR v_new.recovery_otp_ttl_seconds > 3600 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.recovery_max_attempts < 1 OR v_new.recovery_max_attempts > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.recovery_reset_token_ttl_seconds < 60 OR v_new.recovery_reset_token_ttl_seconds > 1800 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;

  IF v_new.custom_mfa_challenge_ttl_seconds < 30 OR v_new.custom_mfa_challenge_ttl_seconds > 3600 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.custom_mfa_max_resends < 0 OR v_new.custom_mfa_max_resends > 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.custom_mfa_max_attempts < 1 OR v_new.custom_mfa_max_attempts > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.custom_mfa_grant_lifetime_minutes < 1 OR v_new.custom_mfa_grant_lifetime_minutes > 1440 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;

  v_before_state := to_jsonb(v_current) - 'updated_at' - 'updated_by' - 'settings_version';
  v_after_state := to_jsonb(v_new) - 'updated_at' - 'updated_by' - 'settings_version';
  IF v_before_state = v_after_state THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
  END IF;

  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_stepup_grant.id
    AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  v_new_version := v_current.settings_version + 1;

  UPDATE public.auth_security_settings SET
    settings_version = v_new_version,
    username_login = v_new.username_login,
    email_login = v_new.email_login,
    phone_login = v_new.phone_login,
    mfa_policy = v_new.mfa_policy,
    registration_enabled = v_new.registration_enabled,
    registration_requires_admin_approval = v_new.registration_requires_admin_approval,
    require_profile_completion = v_new.require_profile_completion,
    allow_totp_mfa = v_new.allow_totp_mfa,
    allow_bale_mfa = v_new.allow_bale_mfa,
    allow_email_mfa = v_new.allow_email_mfa,
    allow_recovery_codes = v_new.allow_recovery_codes,
    session_idle_timeout_minutes = v_new.session_idle_timeout_minutes,
    session_absolute_lifetime_minutes = v_new.session_absolute_lifetime_minutes,
    max_active_sessions = v_new.max_active_sessions,
    session_management_enabled = v_new.session_management_enabled,
    session_heartbeat_interval_seconds = v_new.session_heartbeat_interval_seconds,
    lock_threshold = v_new.lock_threshold,
    lock_duration_minutes = v_new.lock_duration_minutes,
    progressive_lock_enabled = v_new.progressive_lock_enabled,
    progressive_lock_schedule = v_new.progressive_lock_schedule,
    recovery_enabled = v_new.recovery_enabled,
    unified_recovery_enabled = v_new.unified_recovery_enabled,
    recovery_otp_ttl_seconds = v_new.recovery_otp_ttl_seconds,
    recovery_max_attempts = v_new.recovery_max_attempts,
    recovery_reset_token_ttl_seconds = v_new.recovery_reset_token_ttl_seconds,
    custom_mfa_enabled = v_new.custom_mfa_enabled,
    custom_mfa_required = v_new.custom_mfa_required,
    custom_mfa_allowed_factors = v_new.custom_mfa_allowed_factors,
    custom_mfa_challenge_ttl_seconds = v_new.custom_mfa_challenge_ttl_seconds,
    custom_mfa_max_resends = v_new.custom_mfa_max_resends,
    custom_mfa_max_attempts = v_new.custom_mfa_max_attempts,
    custom_mfa_grant_lifetime_minutes = v_new.custom_mfa_grant_lifetime_minutes,
    updated_at = now(),
    updated_by = v_uid
  WHERE id = 1;

  INSERT INTO public.auth_security_settings_history (
    version, username_login, email_login, phone_login, mfa_policy,
    allow_totp_mfa, allow_bale_mfa, allow_email_mfa, allow_recovery_codes,
    registration_enabled, registration_requires_admin_approval, require_profile_completion,
    session_idle_timeout_minutes, session_absolute_lifetime_minutes, max_active_sessions,
    lock_threshold, lock_duration_minutes, recovery_enabled,
    changed_by, change_reason
  ) VALUES (
    v_new_version, v_new.username_login, v_new.email_login, v_new.phone_login, v_new.mfa_policy,
    v_new.allow_totp_mfa, v_new.allow_bale_mfa, v_new.allow_email_mfa, v_new.allow_recovery_codes,
    v_new.registration_enabled, v_new.registration_requires_admin_approval, v_new.require_profile_completion,
    v_new.session_idle_timeout_minutes, v_new.session_absolute_lifetime_minutes, v_new.max_active_sessions,
    v_new.lock_threshold, v_new.lock_duration_minutes, v_new.recovery_enabled,
    v_uid, v_reason
  );

  SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
  INTO v_changed_keys
  FROM jsonb_object_keys(p_patch) AS k;

  INSERT INTO public.security_audit_events (
    user_id, actor_user_id, event_type, event_category, severity, metadata, session_id, result
  ) VALUES (
    v_uid,
    v_uid,
    'security_settings_changed',
    'settings_change',
    'warning',
    jsonb_build_object(
      'old_version', v_current.settings_version,
      'new_version', v_new_version,
      'changed_keys', v_changed_keys
    ),
    v_session_id,
    'success'
  );

  RETURN jsonb_build_object('ok', true, 'new_version', v_new_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_auth_failure(
  p_user_id uuid,
  p_identifier_hash text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_progressive_enabled boolean := false;
  v_recent_failures integer;
  v_threshold integer := 5;
  v_fixed_lock_minutes integer := 30;
  v_schedule text[] := ARRAY['1','6','12','24','48','72']::text[];
  v_current_lock_level integer;
  v_new_lock_level integer;
  v_lock_hours integer;
  v_locked_until timestamptz;
  v_profile_locked_until timestamptz;
  v_schedule_len integer;
BEGIN
  IF p_user_id IS NULL OR p_identifier_hash IS NULL OR p_ip_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  SELECT
    COALESCE(progressive_lock_enabled, false),
    COALESCE(lock_threshold, 5),
    COALESCE(lock_duration_minutes, 30),
    COALESCE(progressive_lock_schedule, ARRAY['1','6','12','24','48','72']::text[])
  INTO v_progressive_enabled, v_threshold, v_fixed_lock_minutes, v_schedule
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  v_threshold := GREATEST(1, LEAST(v_threshold, 50));
  v_fixed_lock_minutes := GREATEST(1, LEAST(v_fixed_lock_minutes, 1440));

  IF COALESCE(array_length(v_schedule, 1), 0) < 1
     OR COALESCE(array_length(v_schedule, 1), 0) > 12
     OR EXISTS (
       SELECT 1
       FROM unnest(COALESCE(v_schedule, ARRAY[]::text[])) AS entry
       WHERE CASE
         WHEN entry ~ '^[0-9]+$' THEN entry::integer < 1 OR entry::integer > 720
         ELSE true
       END
     ) THEN
    v_schedule := ARRAY['1','6','12','24','48','72']::text[];
  END IF;
  v_schedule_len := array_length(v_schedule, 1);

  SELECT locked_until INTO v_profile_locked_until
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_profile_locked_until IS NOT NULL AND v_profile_locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', true,
      'locked', true,
      'locked_until', v_profile_locked_until,
      'rate_limited', false
    );
  END IF;

  SELECT count(*) INTO v_recent_failures
  FROM public.auth_lock_events
  WHERE user_id = p_user_id
    AND created_at > now() - interval '24 hours';

  INSERT INTO public.auth_lock_events (
    user_id, identifier_hash, ip_hash, failure_count, lock_level, locked_until
  ) VALUES (
    p_user_id, p_identifier_hash, p_ip_hash, 1, 0, NULL
  );

  v_recent_failures := v_recent_failures + 1;

  IF v_recent_failures < v_threshold THEN
    RETURN jsonb_build_object(
      'ok', true,
      'locked', false,
      'rate_limited', false,
      'failures', v_recent_failures
    );
  END IF;

  IF NOT v_progressive_enabled THEN
    v_locked_until := now() + make_interval(mins => v_fixed_lock_minutes);

    UPDATE public.profiles
    SET locked_until = v_locked_until
    WHERE user_id = p_user_id;

    UPDATE public.auth_lock_events
    SET failure_count = v_recent_failures,
        lock_level = 0,
        locked_until = v_locked_until
    WHERE id = (
      SELECT id FROM public.auth_lock_events
      WHERE user_id = p_user_id
      ORDER BY created_at DESC
      LIMIT 1
    );

    RETURN jsonb_build_object(
      'ok', true,
      'locked', true,
      'progressive', false,
      'locked_until', v_locked_until,
      'lock_minutes', v_fixed_lock_minutes
    );
  END IF;

  SELECT COALESCE(max(lock_level), 0) INTO v_current_lock_level
  FROM public.auth_lock_events
  WHERE user_id = p_user_id
    AND lock_level > 0
    AND locked_until IS NOT NULL
    AND locked_until > now() - interval '72 hours';

  v_new_lock_level := v_current_lock_level + 1;

  IF v_new_lock_level > v_schedule_len THEN
    UPDATE public.profiles
    SET account_status = 'LOCKED', locked_until = NULL
    WHERE user_id = p_user_id;

    UPDATE public.auth_lock_events
    SET failure_count = v_recent_failures,
        lock_level = v_new_lock_level,
        locked_until = now() + interval '72 hours'
    WHERE id = (
      SELECT id FROM public.auth_lock_events
      WHERE user_id = p_user_id
      ORDER BY created_at DESC
      LIMIT 1
    );

    RETURN jsonb_build_object(
      'ok', true,
      'locked', true,
      'progressive', true,
      'admin_unlock_required', true,
      'lock_level', v_new_lock_level
    );
  END IF;

  v_lock_hours := v_schedule[v_new_lock_level]::integer;
  v_locked_until := now() + make_interval(hours => v_lock_hours);

  UPDATE public.profiles
  SET locked_until = v_locked_until
  WHERE user_id = p_user_id;

  UPDATE public.auth_lock_events
  SET failure_count = v_recent_failures,
      lock_level = v_new_lock_level,
      locked_until = v_locked_until
  WHERE id = (
    SELECT id FROM public.auth_lock_events
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 1
  );

  RETURN jsonb_build_object(
    'ok', true,
    'locked', true,
    'progressive', true,
    'locked_until', v_locked_until,
    'lock_level', v_new_lock_level,
    'lock_hours', v_lock_hours
  );
END;
$function$;
