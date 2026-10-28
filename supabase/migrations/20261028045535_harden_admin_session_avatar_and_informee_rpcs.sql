-- Reuse the canonical gate in owner-executed RPCs; preserve role, step-up,
-- ownership, version checks and existing result shapes.
CREATE OR REPLACE FUNCTION private.list_locked_accounts()
 RETURNS TABLE(user_id uuid, full_name text, email text, username text, phone text, account_status text, locked_until timestamp with time zone, lock_type text, lock_level integer, failure_count integer, last_failure_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RAISE EXCEPTION 'SESSION_NOT_FULLY_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_session_id := NULL;
  END;

  IF v_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = v_session_id AND s.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.user_id = v_actor
      AND actor.is_security_admin IS TRUE
      AND actor.is_active IS TRUE
      AND actor.account_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SECURITY_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    p.full_name::text,
    p.email::text,
    p.username::text,
    p.phone::text,
    p.account_status::text,
    p.locked_until,
    CASE WHEN p.account_status = 'LOCKED' THEN 'admin' ELSE 'temporary' END::text,
    COALESCE(last_event.lock_level, 0)::integer,
    COALESCE(last_event.failure_count, 0)::integer,
    last_event.created_at
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT e.lock_level, e.failure_count, e.created_at
    FROM public.auth_lock_events e
    WHERE e.user_id = p.user_id
      AND e.created_at > COALESCE(p.auth_lock_reset_at, '-infinity'::timestamptz)
    ORDER BY e.created_at DESC
    LIMIT 1
  ) last_event ON TRUE
  WHERE p.account_status = 'LOCKED'
     OR (p.locked_until IS NOT NULL AND p.locked_until > now())
  ORDER BY
    CASE WHEN p.account_status = 'LOCKED' THEN 0 ELSE 1 END,
    p.locked_until DESC NULLS FIRST,
    lower(COALESCE(p.full_name, p.email, p.username, '')),
    p.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.list_malformed_phone_records()
 RETURNS TABLE(auth_user_id uuid, email text, phone text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, deleted_at timestamp with time zone, normalized_phone text, has_real_email boolean, has_phone boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RAISE EXCEPTION 'SESSION_NOT_FULLY_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_security_admin IS TRUE
      AND p.is_active IS TRUE
      AND p.account_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SECURITY_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS auth_user_id,
    u.email::text,
    u.phone::text,
    u.created_at,
    u.last_sign_in_at,
    u.deleted_at,
    CASE
      WHEN u.phone IS NOT NULL AND btrim(u.phone) <> ''
        THEN public.normalize_iran_phone(u.phone)
      ELSE NULL
    END AS normalized_phone,
    CASE
      WHEN u.email IS NOT NULL
       AND u.email NOT ILIKE '%@auth.spark.invalid'
        THEN true
      ELSE false
    END AS has_real_email,
    CASE
      WHEN u.phone IS NOT NULL AND btrim(u.phone) <> ''
        THEN true
      ELSE false
    END AS has_phone
  FROM auth.users u
  LEFT JOIN public.profiles p
    ON p.user_id = u.id
  WHERE
    p.user_id IS NULL
    AND u.deleted_at IS NULL
    AND (
      (u.phone IS NOT NULL AND btrim(u.phone) <> '')
      OR
      (
        u.email IS NOT NULL
        AND btrim(u.email) <> ''
        AND u.email NOT ILIKE '%@auth.spark.invalid'
      )
    )
  ORDER BY u.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_auth_security_settings_patch(p_expected_version integer, p_patch jsonb, p_change_reason text DEFAULT NULL::text)
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

  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FULLY_AUTHORIZED');
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
    AND factor_type = 'totp'
    AND assurance_level = 'aal2'
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
         WHEN entry ~ '^[0-9]+$' THEN entry::integer < 1 OR entry::integer > 43200
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

CREATE OR REPLACE FUNCTION public.set_phone_password_recovery_config(p_enabled boolean)
 RETURNS TABLE(success boolean, error text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_provider_ready boolean := false;
  v_e2e_verified boolean := false;
  v_secret_confirmed boolean := false;
  v_template_ready boolean := false;
  v_ttl_text text := '';
  v_ttl_seconds integer := 0;
  v_test_mode boolean := false;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, 'NOT_AUTHENTICATED'::text;
    RETURN;
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN QUERY SELECT false, 'SESSION_NOT_FULLY_AUTHORIZED'::text;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles WHERE user_id = v_caller_uid LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'NOT_ADMIN'::text;
    RETURN;
  END IF;

  IF NOT p_enabled THEN
    UPDATE public.system_config SET value = 'false'
    WHERE section = 'security' AND key = 'phone_password_recovery_enabled';
    RETURN QUERY SELECT true, NULL::text;
    RETURN;
  END IF;

  -- Gate: test mode must be off
  SELECT (value = 'true') INTO v_test_mode
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_test_mode' LIMIT 1;
  IF COALESCE(v_test_mode, false) THEN
    RETURN QUERY SELECT false, 'TEST_MODE_STILL_ACTIVE'::text;
    RETURN;
  END IF;

  -- Gate: provider ready
  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid AND is_active = true LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;
  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);
  IF NOT v_provider_ready THEN
    RETURN QUERY SELECT false, 'PROVIDER_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: template ready
  BEGIN
    SELECT EXISTS(
      SELECT 1 FROM public.notification_templates
      WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    ) INTO v_template_ready;
  EXCEPTION WHEN OTHERS THEN v_template_ready := false; END;
  IF NOT v_template_ready THEN
    RETURN QUERY SELECT false, 'TEMPLATE_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: secret confirmed
  SELECT (value = 'true') INTO v_secret_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed' LIMIT 1;
  IF NOT COALESCE(v_secret_confirmed, false) THEN
    RETURN QUERY SELECT false, 'SECRET_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate: E2E verified
  SELECT (value = 'true') INTO v_e2e_verified
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_e2e_verified' LIMIT 1;
  IF NOT COALESCE(v_e2e_verified, false) THEN
    RETURN QUERY SELECT false, 'E2E_NOT_VERIFIED'::text;
    RETURN;
  END IF;

  -- Gate: TTL valid
  SELECT value INTO v_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;
  BEGIN
    v_ttl_seconds := v_ttl_text::integer;
  EXCEPTION WHEN OTHERS THEN v_ttl_seconds := 0; END;
  IF v_ttl_seconds < 60 OR v_ttl_seconds > 86400 THEN
    RETURN QUERY SELECT false, 'INVALID_TTL'::text;
    RETURN;
  END IF;

  UPDATE public.system_config SET value = 'true'
  WHERE section = 'security' AND key = 'phone_password_recovery_enabled';
  RETURN QUERY SELECT true, NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION private.clear_malformed_phone_record(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_grant_id uuid;
  v_target_email text;
  v_target_phone text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FULLY_AUTHORIZED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = v_actor
      AND p.is_security_admin IS TRUE
      AND p.is_active IS TRUE
      AND p.account_status = 'ACTIVE'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END;

  IF v_session_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM auth.sessions s
    WHERE s.id = v_session_id
      AND s.user_id = v_actor
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT g.id
  INTO v_grant_id
  FROM public.session_security_grants g
  WHERE g.user_id = v_actor
    AND g.session_id = v_session_id
    AND g.grant_type = 'mfa_stepup'
    AND g.purpose = 'auth_settings_change'
    AND g.factor_type = 'totp'
    AND g.assurance_level = 'aal2'
    AND g.consumed_at IS NULL
    AND g.expires_at > now()
  ORDER BY g.issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  SELECT u.email::text, u.phone::text
  INTO v_target_email, v_target_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.id = p_user_id
    AND p.user_id IS NULL
    AND u.deleted_at IS NULL
    AND (
      (u.phone IS NOT NULL AND btrim(u.phone) <> '')
      OR (
        u.email IS NOT NULL
        AND btrim(u.email) <> ''
        AND u.email NOT ILIKE '%@auth.spark.invalid'
      )
    )
  FOR UPDATE OF u;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORPHAN_AUTH_USER_NOT_ELIGIBLE');
  END IF;

  BEGIN
    UPDATE public.session_security_grants
    SET consumed_at = now()
    WHERE id = v_grant_id
      AND consumed_at IS NULL;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
    END IF;

    DELETE FROM auth.users
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TARGET_DISAPPEARED' USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN foreign_key_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'USER_HAS_REFERENCES');
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ORPHAN_AUTH_USER_NOT_ELIGIBLE');
  END;

  INSERT INTO public.security_audit_events (
    user_id,
    actor_user_id,
    event_type,
    event_category,
    severity,
    metadata,
    session_id,
    result
  ) VALUES (
    p_user_id,
    v_actor,
    'orphan_auth_user_deleted',
    'settings_change',
    'warning',
    jsonb_build_object(
      'had_phone', v_target_phone IS NOT NULL AND btrim(v_target_phone) <> '',
      'had_real_email', v_target_email IS NOT NULL AND btrim(v_target_email) <> '' AND v_target_email NOT ILIKE '%@auth.spark.invalid'
    ),
    v_session_id,
    'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_deleted', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.security_admin_unlock_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_grant_id uuid;
  v_previous_status text;
  v_previous_locked_until timestamptz;
  v_reset_at timestamptz := clock_timestamp();
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FULLY_AUTHORIZED');
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END;

  IF v_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = v_session_id AND s.user_id = v_actor
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.user_id = v_actor
      AND actor.is_security_admin IS TRUE
      AND actor.is_active IS TRUE
      AND actor.account_status = 'ACTIVE'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USER_ID');
  END IF;

  SELECT p.account_status, p.locked_until
  INTO v_previous_status, v_previous_locked_until
  FROM public.profiles p
  WHERE p.user_id = p_user_id
    AND (
      p.account_status = 'LOCKED'
      OR (p.locked_until IS NOT NULL AND p.locked_until > now())
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_LOCKED');
  END IF;

  SELECT g.id INTO v_grant_id
  FROM public.session_security_grants g
  WHERE g.user_id = v_actor
    AND g.session_id = v_session_id
    AND g.grant_type = 'mfa_stepup'
    AND g.purpose = 'account_security_change'
    AND g.factor_type = 'totp'
    AND g.assurance_level = 'aal2'
    AND g.consumed_at IS NULL
    AND g.expires_at > now()
  ORDER BY g.issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_grant_id AND consumed_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.profiles
  SET
    locked_until = NULL,
    auth_lock_reset_at = v_reset_at,
    account_status = CASE WHEN account_status = 'LOCKED' THEN 'ACTIVE' ELSE account_status END,
    account_status_changed_at = CASE WHEN account_status = 'LOCKED' THEN v_reset_at ELSE account_status_changed_at END,
    account_status_changed_by = CASE WHEN account_status = 'LOCKED' THEN v_actor ELSE account_status_changed_by END,
    updated_at = v_reset_at
  WHERE user_id = p_user_id;

  INSERT INTO public.security_audit_events (
    user_id, actor_user_id, event_type, event_category, severity,
    metadata, session_id, result
  ) VALUES (
    p_user_id,
    v_actor,
    'account_unlocked_by_security_admin',
    'account_lock',
    'info',
    jsonb_build_object(
      'previous_status', v_previous_status,
      'previous_locked_until', v_previous_locked_until,
      'failure_counter_reset_at', v_reset_at,
      'unlock_type', CASE WHEN v_previous_status = 'LOCKED' THEN 'admin' ELSE 'temporary' END
    ),
    v_session_id,
    'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'previous_status', v_previous_status,
    'previous_locked_until', v_previous_locked_until,
    'failure_counter_reset_at', v_reset_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_phone_password_recovery_test_mode(p_enabled boolean, p_test_phone text)
 RETURNS TABLE(success boolean, masked_phone text, error text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_provider_ready boolean := false;
  v_template_ready boolean := false;
  v_secret_confirmed boolean := false;
  v_ttl_text text := '';
  v_ttl_seconds int := 0;
  v_public_enabled boolean := false;
  v_normalized_phone text;
  v_resolve_status text;
  v_resolve_user_id uuid;
  v_masked text;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'NOT_AUTHENTICATED'::text;
    RETURN;
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN QUERY SELECT false, NULL::text, 'SESSION_NOT_FULLY_AUTHORIZED'::text;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles WHERE user_id = v_caller_uid LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, NULL::text, 'NOT_ADMIN'::text;
    RETURN;
  END IF;

  -- Disable path
  IF NOT p_enabled THEN
    UPDATE public.system_config SET value = 'false'
    WHERE section = 'security' AND key = 'phone_password_recovery_test_mode';
    UPDATE public.system_config SET value = ''
    WHERE section = 'security' AND key = 'phone_password_recovery_test_phone';
    RETURN QUERY SELECT true, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Enable path: all gates must pass

  -- Gate: public recovery must be false
  SELECT (value = 'true') INTO v_public_enabled
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_enabled' LIMIT 1;

  IF COALESCE(v_public_enabled, false) THEN
    RETURN QUERY SELECT false, NULL::text, 'PUBLIC_RECOVERY_ENABLED'::text;
    RETURN;
  END IF;

  -- Gate: provider ready
  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid AND is_active = true LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;
  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);

  IF NOT v_provider_ready THEN
    RETURN QUERY SELECT false, NULL::text, 'PROVIDER_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: template ready
  BEGIN
    SELECT EXISTS(
      SELECT 1 FROM public.notification_templates
      WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    ) INTO v_template_ready;
  EXCEPTION WHEN OTHERS THEN v_template_ready := false; END;

  IF NOT v_template_ready THEN
    RETURN QUERY SELECT false, NULL::text, 'TEMPLATE_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: secret confirmed
  SELECT (value = 'true') INTO v_secret_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed' LIMIT 1;

  IF NOT COALESCE(v_secret_confirmed, false) THEN
    RETURN QUERY SELECT false, NULL::text, 'SECRET_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate: TTL valid
  SELECT value INTO v_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;

  BEGIN
    v_ttl_seconds := v_ttl_text::integer;
  EXCEPTION WHEN OTHERS THEN v_ttl_seconds := 0; END;

  IF v_ttl_seconds < 60 OR v_ttl_seconds > 86400 THEN
    RETURN QUERY SELECT false, NULL::text, 'INVALID_TTL'::text;
    RETURN;
  END IF;

  -- Gate: test phone must be valid
  v_normalized_phone := public.normalize_iran_phone_sql(p_test_phone);
  IF v_normalized_phone !~ '^989\d{9}$' THEN
    RETURN QUERY SELECT false, NULL::text, 'INVALID_PHONE'::text;
    RETURN;
  END IF;

  -- Use detailed resolver for specific error codes
  SELECT status, user_id INTO v_resolve_status, v_resolve_user_id
  FROM public.resolve_phone_password_reset_target_detailed(v_normalized_phone);

  IF v_resolve_status IS NULL OR v_resolve_status <> 'MATCHED' THEN
    -- Map detailed status to error code
    RETURN QUERY SELECT false, NULL::text, COALESCE(v_resolve_status, 'PHONE_NOT_UNIQUE')::text;
    RETURN;
  END IF;

  -- All gates passed — enable test mode
  UPDATE public.system_config SET value = 'true'
  WHERE section = 'security' AND key = 'phone_password_recovery_test_mode';
  UPDATE public.system_config SET value = p_test_phone
  WHERE section = 'security' AND key = 'phone_password_recovery_test_phone';

  -- Mask phone: 98912345678 → 98912****78
  v_masked := substr(v_normalized_phone, 1, 5) || '****' || substr(v_normalized_phone, length(v_normalized_phone) - 1);

  RETURN QUERY SELECT true, v_masked, NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_informee_meetings_v1()
 RETURNS TABLE(id uuid, subject text, request_date text, start_time text, end_time text, user_id uuid, participant_user_ids uuid[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    m.id,
    m.subject,
    m.request_date,
    m.start_time,
    m.end_time,
    m.user_id,
    COALESCE(m.participant_user_ids, ARRAY[]::uuid[])
  FROM public.meetings AS m
  WHERE auth.uid() IS NOT NULL
    AND private.is_current_session_fully_authorized()
    AND auth.uid() = ANY(COALESCE(m.notify_users, ARRAY[]::uuid[]))
    AND m.status <> 'closed'
  ORDER BY m.request_date DESC;
$function$;

-- The avatar-upload Edge Function calls this with its admin/service client.
-- Browser and anonymous callers must not enqueue jobs directly.
REVOKE ALL ON FUNCTION public.create_avatar_job(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_avatar_job(uuid,text) TO service_role;
