/*
# Phase 4 — Profile Completion and Admin Approval

## Summary
Implements profile completion RPCs, account lifecycle management RPCs,
lifecycle setter with TOTP step-up, pre-request allowlist update, and
get_public_auth_config replacement with registration readiness fields.

## Safety
- No prior migration modified
- No data deleted
- No MFA policy changed
*/

-- ════════════════════════════════════════════════════════════
-- 1. get_my_profile_completion_state
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_profile_completion_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT
    user_id, full_name, username, email, phone, phone_verified_at,
    organization, position, department, employee_id,
    birth_date, gender, city, location, bio, website, linkedin_url,
    profile_completion_status, profile_completion_version,
    account_status
  INTO v_profile
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'user_id', v_profile.user_id,
      'full_name', v_profile.full_name,
      'username', v_profile.username,
      'email', v_profile.email,
      'phone', v_profile.phone,
      'phone_verified_at', v_profile.phone_verified_at,
      'organization', v_profile.organization,
      'position', v_profile.position,
      'department', v_profile.department,
      'employee_id', v_profile.employee_id,
      'birth_date', v_profile.birth_date,
      'gender', v_profile.gender,
      'city', v_profile.city,
      'location', v_profile.location,
      'bio', v_profile.bio,
      'website', v_profile.website,
      'linkedin_url', v_profile.linkedin_url,
      'profile_completion_status', v_profile.profile_completion_status,
      'profile_completion_version', v_profile.profile_completion_version,
      'account_status', v_profile.account_status
    )
  );
END;
$function$;

ALTER FUNCTION public.get_my_profile_completion_state() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_completion_state() TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. save_my_profile_completion
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_my_profile_completion(
  p_patch jsonb,
  p_expected_version bigint,
  p_mark_complete boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile record;
  v_new_version bigint;
  v_patch_keys text[];
  v_allowed_keys text[] := ARRAY[
    'full_name', 'organization', 'position', 'department',
    'employee_id', 'birth_date', 'gender', 'city', 'location',
    'bio', 'website', 'linkedin_url'
  ];
  v_key text;
  v_val jsonb;
  v_full_name text;
  v_username text;
  v_email text;
  v_phone text;
  v_phone_verified timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  IF v_profile.account_status IS DISTINCT FROM 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE');
  END IF;

  IF v_profile.profile_completion_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'VERSION_CONFLICT',
      'current_version', v_profile.profile_completion_version
    );
  END IF;

  v_patch_keys := ARRAY(SELECT jsonb_object_keys(p_patch));
  FOREACH v_key IN ARRAY v_patch_keys LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'FIELD_NOT_ALLOWED', 'field', v_key);
    END IF;
  END LOOP;

  PERFORM set_config('app.profile_completion_write', 'true', true);

  v_new_version := v_profile.profile_completion_version + 1;

  FOREACH v_key IN ARRAY v_patch_keys LOOP
    v_val := p_patch -> v_key;
    EXECUTE format('UPDATE public.profiles SET %I = $1 WHERE user_id = $2', v_key)
      USING v_val #>> '{}', v_uid;
  END LOOP;

  IF v_profile.profile_completion_status = 'NOT_STARTED' THEN
    UPDATE public.profiles SET profile_completion_status = 'IN_PROGRESS' WHERE user_id = v_uid;
  END IF;

  IF p_mark_complete THEN
    SELECT full_name, username, email, phone, phone_verified_at
    INTO v_full_name, v_username, v_email, v_phone, v_phone_verified
    FROM public.profiles WHERE user_id = v_uid LIMIT 1;

    IF NULLIF(TRIM(COALESCE(v_full_name, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(v_username, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(v_email, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(v_phone, '')), '') IS NULL
       OR v_phone_verified IS NULL
    THEN
      PERFORM set_config('app.profile_completion_write', 'false', true);
      RETURN jsonb_build_object('ok', false, 'error', 'COMPLETION_REQUIREMENTS_NOT_MET');
    END IF;

    UPDATE public.profiles
    SET profile_completion_status = 'COMPLETE',
        profile_completion_version = v_new_version
    WHERE user_id = v_uid;
  ELSE
    UPDATE public.profiles
    SET profile_completion_version = v_new_version
    WHERE user_id = v_uid;
  END IF;

  PERFORM set_config('app.profile_completion_write', 'false', true);

  INSERT INTO public.security_audit_events (
    actor_user_id, target_user_id,
    event_type, event_category, severity,
    result, metadata
  ) VALUES (
    v_uid, v_uid,
    CASE WHEN p_mark_complete THEN 'profile_completion_completed' ELSE 'profile_completion_saved' END,
    'access', 'info',
    'success',
    public.sanitize_audit_metadata(jsonb_build_object(
      'action', CASE WHEN p_mark_complete THEN 'complete' ELSE 'save' END,
      'new_version', v_new_version
    ))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'new_version', v_new_version,
    'profile_completion_status', CASE WHEN p_mark_complete THEN 'COMPLETE' ELSE 'IN_PROGRESS' END
  );
END;
$function$;

ALTER FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 3. get_account_lifecycle_management_state
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_account_lifecycle_management_state(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
  v_search text;
  v_limit int := COALESCE(p_limit, 50);
  v_offset int := COALESCE(p_offset, 0);
  v_users jsonb;
  v_summary jsonb;
  v_total_matches int;
  v_has_more boolean := false;
  v_pagination jsonb;
  v_phone_unverified int;
  v_pending int;
  v_active int;
  v_rejected int;
  v_suspended int;
  v_locked int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  IF v_limit < 1 OR v_limit > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT');
  END IF;

  IF v_offset < 0 OR v_offset > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OFFSET');
  END IF;

  v_search := NULLIF(trim(COALESCE(p_search, '')), '');

  WITH filtered_users AS (
    SELECT
      p.user_id, p.full_name, p.username, p.email, p.phone,
      p.account_status, p.is_active, p.phone_verified_at,
      p.profile_completion_status, p.account_lifecycle_version,
      p.created_at
    FROM public.profiles p
    WHERE (
      p_status IS NULL OR p.account_status = p_status
    )
    AND (
      v_search IS NULL
      OR position(lower(v_search) in lower(COALESCE(p.full_name, ''))) > 0
      OR position(lower(v_search) in lower(COALESCE(p.username, ''))) > 0
    )
  ),
  page_plus_one AS (
    SELECT * FROM filtered_users
    ORDER BY
      CASE account_status
        WHEN 'PENDING_ADMIN_APPROVAL' THEN 0
        WHEN 'PHONE_UNVERIFIED' THEN 1
        WHEN 'ACTIVE' THEN 2
        WHEN 'SUSPENDED' THEN 3
        WHEN 'REJECTED' THEN 4
        WHEN 'LOCKED' THEN 5
      END,
      full_name NULLS LAST,
      user_id
    LIMIT v_limit + 1
    OFFSET v_offset
  ),
  visible_page AS (
    SELECT * FROM page_plus_one
    LIMIT v_limit
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', vp.user_id,
          'full_name', vp.full_name,
          'username', vp.username,
          'masked_email', public.mask_email(vp.email),
          'masked_phone', public.mask_phone(vp.phone),
          'account_status', vp.account_status,
          'is_active', vp.is_active,
          'phone_verified', vp.phone_verified_at IS NOT NULL,
          'profile_completion_status', vp.profile_completion_status,
          'account_lifecycle_version', vp.account_lifecycle_version,
          'created_at', vp.created_at,
          'eligibility', jsonb_build_object(
            'can_approve', vp.account_status = 'PENDING_ADMIN_APPROVAL' AND vp.phone_verified_at IS NOT NULL,
            'can_reject', vp.account_status = 'PENDING_ADMIN_APPROVAL',
            'can_reopen', vp.account_status = 'REJECTED',
            'can_suspend', vp.account_status = 'ACTIVE',
            'can_reactivate', vp.account_status = 'SUSPENDED'
          )
        ) ORDER BY
          CASE vp.account_status
            WHEN 'PENDING_ADMIN_APPROVAL' THEN 0
            WHEN 'PHONE_UNVERIFIED' THEN 1
            WHEN 'ACTIVE' THEN 2
            WHEN 'SUSPENDED' THEN 3
            WHEN 'REJECTED' THEN 4
            WHEN 'LOCKED' THEN 5
          END,
          vp.full_name NULLS LAST,
          vp.user_id
        )
        FROM visible_page vp
      ),
      '[]'::jsonb
    ),
    (
      SELECT count(*) > v_limit
      FROM page_plus_one
    ),
    (
      SELECT count(*)
      FROM filtered_users
    )
  INTO
    v_users,
    v_has_more,
    v_total_matches;

  v_pagination := jsonb_build_object(
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_has_more,
    'total_matches', v_total_matches
  );

  SELECT count(*) INTO v_phone_unverified FROM public.profiles WHERE account_status = 'PHONE_UNVERIFIED';
  SELECT count(*) INTO v_pending FROM public.profiles WHERE account_status = 'PENDING_ADMIN_APPROVAL';
  SELECT count(*) INTO v_active FROM public.profiles WHERE account_status = 'ACTIVE';
  SELECT count(*) INTO v_rejected FROM public.profiles WHERE account_status = 'REJECTED';
  SELECT count(*) INTO v_suspended FROM public.profiles WHERE account_status = 'SUSPENDED';
  SELECT count(*) INTO v_locked FROM public.profiles WHERE account_status = 'LOCKED';

  v_summary := jsonb_build_object(
    'phone_unverified', v_phone_unverified,
    'pending_approval', v_pending,
    'active', v_active,
    'rejected', v_rejected,
    'suspended', v_suspended,
    'locked', v_locked
  );

  RETURN jsonb_build_object(
    'ok', true,
    'users', v_users,
    'pagination', v_pagination,
    'summary', v_summary
  );
END;
$function$;

ALTER FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 4. set_user_account_lifecycle_state
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_user_account_lifecycle_state(
  p_target_user_id uuid,
  p_action text,
  p_expected_version bigint,
  p_change_reason text DEFAULT NULL
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
  v_request_id uuid;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
  v_target_rec record;
  v_stepup_grant public.session_security_grants%ROWTYPE;
  v_trimmed_reason text;
  v_old_status text;
  v_new_status text;
  v_old_is_active boolean;
  v_new_is_active boolean;
  v_new_version bigint;
  v_grant_consumed_count integer;
  v_transition_ok boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  v_request_id := NULLIF(v_jwt ->> 'request_id', '')::uuid;

  SELECT EXISTS(
    SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED');
  END IF;

  IF p_target_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_REQUIRED');
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('APPROVE', 'REJECT', 'REOPEN', 'SUSPEND', 'REACTIVATE') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;

  IF p_expected_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EXPECTED_VERSION_REQUIRED');
  END IF;

  v_trimmed_reason := NULLIF(trim(COALESCE(p_change_reason, '')), '');
  IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_REQUIRED');
  END IF;
  IF length(v_trimmed_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_TOO_LONG');
  END IF;

  IF p_target_user_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_CHANGE_OWN_ACCOUNT');
  END IF;

  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  PERFORM pg_advisory_xact_lock(987654321);

  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT
    user_id, account_status, is_active, account_lifecycle_version, phone_verified_at
  INTO v_target_rec
  FROM public.profiles
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  END IF;

  v_old_status := v_target_rec.account_status;
  v_old_is_active := v_target_rec.is_active;

  CASE p_action
    WHEN 'APPROVE' THEN
      IF v_old_status = 'PENDING_ADMIN_APPROVAL' AND v_target_rec.phone_verified_at IS NOT NULL THEN
        v_new_status := 'ACTIVE';
        v_new_is_active := true;
        v_transition_ok := true;
      END IF;
    WHEN 'REJECT' THEN
      IF v_old_status = 'PENDING_ADMIN_APPROVAL' THEN
        v_new_status := 'REJECTED';
        v_new_is_active := false;
        v_transition_ok := true;
      END IF;
    WHEN 'REOPEN' THEN
      IF v_old_status = 'REJECTED' THEN
        v_new_status := 'PENDING_ADMIN_APPROVAL';
        v_new_is_active := false;
        v_transition_ok := true;
      END IF;
    WHEN 'SUSPEND' THEN
      IF v_old_status = 'ACTIVE' THEN
        v_new_status := 'SUSPENDED';
        v_new_is_active := false;
        v_transition_ok := true;
      END IF;
    WHEN 'REACTIVATE' THEN
      IF v_old_status = 'SUSPENDED' THEN
        v_new_status := 'ACTIVE';
        v_new_is_active := true;
        v_transition_ok := true;
      END IF;
  END CASE;

  IF NOT v_transition_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION', 'current_status', v_old_status);
  END IF;

  SELECT * INTO v_stepup_grant
  FROM public.session_security_grants
  WHERE user_id = v_uid
    AND session_id = v_session_id
    AND grant_type = 'mfa_stepup'
    AND purpose = 'account_security_change'
    AND factor_type = 'totp'
    AND assurance_level = 'aal2'
    AND consumed_at IS NULL
    AND issued_at <= clock_timestamp()
    AND issued_at >= clock_timestamp() - interval '5 minutes'
    AND expires_at > clock_timestamp()
  ORDER BY issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.session_security_grants
  SET consumed_at = clock_timestamp()
  WHERE id = v_stepup_grant.id
    AND consumed_at IS NULL;

  GET DIAGNOSTICS v_grant_consumed_count = ROW_COUNT;

  IF v_grant_consumed_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  IF v_target_rec.account_lifecycle_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'VERSION_CONFLICT',
      'current_version', v_target_rec.account_lifecycle_version
    );
  END IF;

  v_new_version := v_target_rec.account_lifecycle_version + 1;

  PERFORM set_config('app.account_lifecycle_write', 'true', true);

  UPDATE public.profiles
  SET
    account_status = v_new_status,
    is_active = v_new_is_active,
    account_lifecycle_version = v_new_version,
    account_status_changed_at = now(),
    account_status_changed_by = v_uid
  WHERE user_id = p_target_user_id;

  PERFORM set_config('app.account_lifecycle_write', 'false', true);

  IF v_new_status = 'ACTIVE' THEN
    PERFORM public.ensure_default_calendars_for_user(p_target_user_id);
  END IF;

  INSERT INTO public.account_lifecycle_history (
    target_user_id, actor_user_id,
    old_status, new_status,
    old_is_active, new_is_active,
    old_version, new_version,
    action, change_reason,
    session_id, request_id
  ) VALUES (
    p_target_user_id, v_uid,
    v_old_status, v_new_status,
    v_old_is_active, v_new_is_active,
    v_target_rec.account_lifecycle_version, v_new_version,
    p_action, v_trimmed_reason,
    v_session_id, v_request_id
  );

  INSERT INTO public.security_audit_events (
    actor_user_id, target_user_id,
    event_type, event_category, severity,
    session_id, request_id,
    result, metadata
  ) VALUES (
    v_uid, p_target_user_id,
    CASE p_action
      WHEN 'APPROVE' THEN 'account_approved'
      WHEN 'REJECT' THEN 'account_rejected'
      WHEN 'REOPEN' THEN 'account_reopened'
      WHEN 'SUSPEND' THEN 'account_suspended'
      WHEN 'REACTIVATE' THEN 'account_reactivated'
    END,
    'access', 'warning',
    v_session_id, v_request_id,
    'success',
    public.sanitize_audit_metadata(jsonb_build_object(
      'action', p_action,
      'old_status', v_old_status,
      'new_status', v_new_status,
      'new_version', v_new_version
    ))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'new_version', v_new_version,
    'new_status', v_new_status
  );
END;
$function$;

ALTER FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 5. Update enforce_auth_access_pre_request
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.enforce_auth_access_pre_request()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_path text;
  v_uid uuid;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN;
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_path := lower(trim(leading '/' from current_setting('request.path', true)));

  IF v_path IN (
    'rpc/get_my_auth_access_state',
    'rpc/get_public_auth_config',
    'rpc/get_public_login_methods',
    'rpc/get_my_profile_completion_state',
    'rpc/save_my_profile_completion'
  ) THEN
    RETURN;
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED'
    USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- ════════════════════════════════════════════════════════════
-- 6. Replace get_public_auth_config — add registration readiness
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_public_auth_config();

CREATE FUNCTION public.get_public_auth_config()
RETURNS TABLE(
  phone_login_enabled boolean,
  provider_ready boolean,
  operator_confirmed boolean,
  e2e_verified boolean,
  phone_login_test_mode boolean,
  phone_login_test_ready boolean,
  phone_login_ready boolean,
  otp_ttl_operator_confirmed boolean,
  phone_password_recovery_enabled boolean,
  phone_password_recovery_test_mode boolean,
  phone_password_recovery_test_ready boolean,
  phone_password_recovery_ready boolean,
  recovery_template_ready boolean,
  recovery_secret_confirmed boolean,
  recovery_ttl_valid boolean,
  recovery_ttl_seconds integer,
  phone_password_recovery_e2e_verified boolean,
  phone_login_canonical_enabled boolean,
  phone_login_canonical_ready boolean,
  phone_password_recovery_canonical_enabled boolean,
  phone_password_recovery_canonical_ready boolean,
  registration_enabled boolean,
  registration_ready boolean,
  registration_requires_admin_approval boolean,
  require_profile_completion boolean,
  registration_otp_ttl_seconds integer,
  registration_otp_resend_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_login_canonical boolean := false;
  v_recovery_canonical boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_provider_ready boolean := false;
  v_origins_text text := '';
  v_origins_count int := 0;
  v_origins_set boolean := false;
  v_login_template_ready boolean := false;
  v_login_template_body text := '';
  v_recovery_template_ready boolean := false;
  v_recovery_template_body text := '';
  v_recovery_ttl_text text := '';
  v_recovery_ttl_seconds int := 0;
  v_recovery_ttl_valid boolean := false;
  v_recovery_secret_proxy boolean := false;
  v_registration_enabled boolean := false;
  v_registration_requires_admin_approval boolean := false;
  v_require_profile_completion boolean := false;
  v_reg_otp_ttl_text text := '';
  v_reg_otp_ttl_seconds int := 300;
  v_reg_otp_resend_text text := '';
  v_reg_otp_resend_seconds int := 60;
  v_reg_secret_proxy boolean := false;
  v_reg_template_ready boolean := false;
  v_reg_template_body text := '';
  v_registration_ready boolean := false;
BEGIN
  SELECT (value = 'true') INTO v_login_canonical
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_canonical_enabled' LIMIT 1;
  v_login_canonical := COALESCE(v_login_canonical, false);

  SELECT (value = 'true') INTO v_recovery_canonical
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_canonical_enabled' LIMIT 1;
  v_recovery_canonical := COALESCE(v_recovery_canonical, false);

  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT COALESCE(is_active, false) INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;
  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);

  SELECT value INTO v_origins_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1;
  v_origins_text := COALESCE(v_origins_text, '');
  IF btrim(v_origins_text) <> '' THEN
    SELECT COUNT(*) INTO v_origins_count
    FROM unnest(string_to_array(v_origins_text, ',')) AS elem
    WHERE btrim(elem) <> '';
  ELSE
    v_origins_count := 0;
  END IF;
  v_origins_set := v_origins_count > 0;

  BEGIN
    SELECT body INTO v_login_template_body
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_login_template_ready := v_login_template_body IS NOT NULL AND v_login_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN v_login_template_ready := false; END;

  BEGIN
    SELECT body INTO v_recovery_template_body
    FROM public.notification_templates
    WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_recovery_template_ready := v_recovery_template_body IS NOT NULL AND v_recovery_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN v_recovery_template_ready := false; END;

  SELECT value INTO v_recovery_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;
  BEGIN
    v_recovery_ttl_seconds := COALESCE(v_recovery_ttl_text::integer, 600);
  EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 600; END;
  v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400;

  SELECT (value = 'true') INTO v_recovery_secret_proxy
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_configured' LIMIT 1;
  v_recovery_secret_proxy := COALESCE(v_recovery_secret_proxy, false);

  SELECT (value = 'true') INTO v_registration_enabled
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  v_registration_enabled := COALESCE(v_registration_enabled, false);

  SELECT COALESCE(registration_requires_admin_approval, false) INTO v_registration_requires_admin_approval
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;

  SELECT COALESCE(require_profile_completion, false) INTO v_require_profile_completion
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;

  SELECT value INTO v_reg_otp_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_ttl_seconds' LIMIT 1;
  BEGIN
    v_reg_otp_ttl_seconds := COALESCE(v_reg_otp_ttl_text::integer, 300);
  EXCEPTION WHEN OTHERS THEN v_reg_otp_ttl_seconds := 300; END;

  SELECT value INTO v_reg_otp_resend_text
  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_resend_seconds' LIMIT 1;
  BEGIN
    v_reg_otp_resend_seconds := COALESCE(v_reg_otp_resend_text::integer, 60);
  EXCEPTION WHEN OTHERS THEN v_reg_otp_resend_seconds := 60; END;

  SELECT (value = 'true') INTO v_reg_secret_proxy
  FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_secret_configured' LIMIT 1;
  v_reg_secret_proxy := COALESCE(v_reg_secret_proxy, false);

  BEGIN
    SELECT body INTO v_reg_template_body
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'registration_phone_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_reg_template_ready := v_reg_template_body IS NOT NULL AND v_reg_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN v_reg_template_ready := false; END;

  v_registration_ready := v_registration_enabled
    AND v_provider_ready
    AND v_reg_template_ready
    AND v_origins_set
    AND v_reg_secret_proxy
    AND v_reg_otp_ttl_seconds >= 60 AND v_reg_otp_ttl_seconds <= 86400;

  RETURN QUERY SELECT
    false,
    v_provider_ready,
    false, false, false, false,
    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,
    false,
    false, false, false,
    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
    v_recovery_template_ready,
    v_recovery_secret_proxy,
    v_recovery_ttl_valid,
    v_recovery_ttl_seconds,
    false,
    v_login_canonical,
    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,
    v_recovery_canonical,
    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
    v_registration_enabled,
    v_registration_ready,
    v_registration_requires_admin_approval,
    v_require_profile_completion,
    v_reg_otp_ttl_seconds,
    v_reg_otp_resend_seconds;
END;
$function$;

ALTER FUNCTION public.get_public_auth_config() OWNER TO postgres;
