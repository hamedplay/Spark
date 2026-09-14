-- Align the Security > Registration controls with the runtime registration,
-- account-lifecycle, and profile-completion flows.

-- The protected-profile trigger must allow only the lifecycle/completion fields
-- intentionally written by the dedicated SECURITY DEFINER flows. Other protected
-- fields remain guarded for non-admin callers.
CREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_completion_write boolean := COALESCE(current_setting('app.profile_completion_write', true), '') = 'true';
  v_account_lifecycle_write boolean := COALESCE(current_setting('app.account_lifecycle_write', true), '') = 'true';
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_current_user_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.can_broadcast IS DISTINCT FROM OLD.can_broadcast
       OR (NEW.organization IS DISTINCT FROM OLD.organization AND NOT v_profile_completion_write)
       OR (NEW.is_active IS DISTINCT FROM OLD.is_active AND NOT v_account_lifecycle_write)
       OR NEW.is_hidden IS DISTINCT FROM OLD.is_hidden
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.telegram_token IS DISTINCT FROM OLD.telegram_token
       OR NEW.webhook_url IS DISTINCT FROM OLD.webhook_url
       OR NEW.google_calendar_token IS DISTINCT FROM OLD.google_calendar_token
       OR NEW.primary_position_id IS DISTINCT FROM OLD.primary_position_id
       OR NEW.primary_unit_id IS DISTINCT FROM OLD.primary_unit_id
       OR NEW.avatar_storage_path IS DISTINCT FROM OLD.avatar_storage_path
       OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
       OR (NEW.position IS DISTINCT FROM OLD.position AND NOT v_profile_completion_write)
       OR NEW.department IS DISTINCT FROM OLD.department AND false
       OR (NEW.username IS DISTINCT FROM OLD.username
           AND NOT (OLD.username IS NULL AND NEW.username IS NOT NULL))
       OR (NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id
           AND NOT (OLD.telegram_chat_id IS NOT NULL AND NEW.telegram_chat_id IS NULL))
    THEN
      RAISE EXCEPTION 'Not allowed to modify protected profile fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Keep profile completion scoped to profiles explicitly placed in IN_PROGRESS
-- by the public-registration flow. This prevents enabling the registration
-- option from retroactively restricting legacy NOT_STARTED accounts.
CREATE OR REPLACE FUNCTION private.evaluate_current_auth_access()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base jsonb;
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_method text;
  v_session_aal text;
  v_jwt_aal text := auth.jwt() ->> 'aal';
  v_has_totp boolean := false;
  v_has_sms boolean := false;
  v_sms_granted boolean := false;
  v_required boolean := false;
  v_reason text;
  v_completion_status text;
BEGIN
  v_base := private.evaluate_current_auth_access_legacy();
  v_reason := v_base ->> 'reason_code';

  -- Legacy accounts have NOT_STARTED. Registration-time completion is represented
  -- by IN_PROGRESS; only that state should activate the registration completion gate.
  IF v_reason = 'PROFILE_COMPLETION_REQUIRED' AND v_uid IS NOT NULL THEN
    SELECT p.profile_completion_status
      INTO v_completion_status
    FROM public.profiles p
    WHERE p.user_id = v_uid
    LIMIT 1;

    IF COALESCE(v_completion_status, 'NOT_STARTED') <> 'IN_PROGRESS' THEN
      v_base := v_base || jsonb_build_object(
        'access_level', 'FULL',
        'reason_code', 'AUTHORIZED',
        'next_step', NULL
      );
      v_reason := 'AUTHORIZED';
    END IF;
  END IF;

  IF COALESCE(v_base ->> 'access_level', 'BLOCKED') = 'BLOCKED'
     OR (COALESCE(v_base ->> 'access_level', 'BLOCKED') = 'RESTRICTED'
         AND v_reason NOT IN ('MFA_ENROLLMENT_REQUIRED', 'MFA_CHALLENGE_REQUIRED', 'MFA_REQUIRED')) THEN
    RETURN v_base;
  END IF;
  IF v_uid IS NULL THEN RETURN v_base; END IF;
  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN v_base;
  END;

  SELECT p.mfa_method, COALESCE(p.mfa_enrollment_required, false)
    INTO v_method, v_required
  FROM public.profiles p
  WHERE p.user_id = v_uid;

  SELECT COALESCE(s.aal::text, '')
    INTO v_session_aal
  FROM auth.sessions s
  WHERE s.id = v_session_id AND s.user_id = v_uid;

  SELECT EXISTS (
    SELECT 1 FROM auth.mfa_factors f
    WHERE f.user_id = v_uid AND f.factor_type = 'totp' AND f.status = 'verified'
  ) INTO v_has_totp;

  SELECT EXISTS (
    SELECT 1 FROM public.custom_mfa_factors f
    WHERE f.user_id = v_uid AND f.factor_type = 'sms' AND f.factor_status = 'active'
  ) INTO v_has_sms;

  SELECT v_required OR COALESCE(s.mfa_policy, 'disabled') = 'required'
    INTO v_required
  FROM public.auth_security_settings s
  WHERE s.id = 1;

  IF v_method IS NULL THEN
    IF v_required THEN
      RETURN v_base || jsonb_build_object(
        'access_level', 'RESTRICTED', 'reason_code', 'MFA_ENROLLMENT_REQUIRED',
        'next_step', 'enroll_mfa', 'mfa_required', true, 'has_verified_totp', v_has_totp
      );
    END IF;
    RETURN v_base || jsonb_build_object(
      'access_level', 'FULL', 'reason_code', 'AUTHORIZED', 'next_step', NULL,
      'mfa_required', false, 'has_verified_totp', v_has_totp
    );
  END IF;

  IF v_method = 'totp' THEN
    IF NOT v_has_totp THEN
      RETURN v_base || jsonb_build_object(
        'access_level', 'RESTRICTED', 'reason_code', 'MFA_ENROLLMENT_REQUIRED',
        'next_step', 'enroll_mfa', 'mfa_required', true, 'has_verified_totp', false
      );
    END IF;
    IF COALESCE(v_session_aal, '') <> 'aal2' OR COALESCE(v_jwt_aal, '') <> 'aal2' THEN
      RETURN v_base || jsonb_build_object(
        'access_level', 'RESTRICTED', 'reason_code', 'MFA_CHALLENGE_REQUIRED',
        'next_step', 'verify_mfa', 'mfa_required', true, 'has_verified_totp', true
      );
    END IF;
    RETURN v_base || jsonb_build_object(
      'access_level', 'FULL', 'reason_code', 'AUTHORIZED', 'next_step', NULL,
      'mfa_required', true, 'has_verified_totp', true
    );
  END IF;

  IF NOT v_has_sms THEN
    RETURN v_base || jsonb_build_object(
      'access_level', 'BLOCKED', 'reason_code', 'MFA_FACTOR_INVALID',
      'next_step', 'login', 'mfa_required', true, 'has_verified_totp', v_has_totp
    );
  END IF;

  SELECT public.has_active_login_sms_mfa_grant(v_uid, v_session_id)
    INTO v_sms_granted;
  IF NOT v_sms_granted THEN
    RETURN v_base || jsonb_build_object(
      'access_level', 'RESTRICTED', 'reason_code', 'MFA_REQUIRED',
      'next_step', 'verify_custom_mfa', 'mfa_required', true, 'has_verified_totp', v_has_totp
    );
  END IF;

  RETURN v_base || jsonb_build_object(
    'access_level', 'FULL', 'reason_code', 'AUTHORIZED', 'next_step', NULL,
    'mfa_required', true, 'has_verified_totp', v_has_totp
  );
END;
$$;

-- Match the RPC contract used by ProfileCompletionGate and return the fields
-- actually edited by that UI.
CREATE OR REPLACE FUNCTION private.get_my_profile_completion_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles p
  WHERE p.user_id = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  IF v_profile.is_active IS NOT TRUE OR v_profile.account_status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE');
  END IF;

  IF v_profile.profile_completion_status <> 'IN_PROGRESS' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_COMPLETION_NOT_REQUIRED');
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
      'profile_completion_version', COALESCE(v_profile.profile_completion_version, 1),
      'account_status', v_profile.account_status
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.save_my_profile_completion(
  p_patch jsonb,
  p_expected_version bigint,
  p_mark_complete boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_merged jsonb;
  v_full_name text;
  v_organization text;
  v_position text;
  v_phone_verified_at timestamptz;
  v_new_version bigint;
  v_unknown_key text;
  v_invalid_key text;
  v_allowed_keys text[] := ARRAY[
    'full_name', 'organization', 'position', 'department', 'employee_id',
    'city', 'location', 'bio', 'website', 'linkedin_url'
  ];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PATCH');
  END IF;

  SELECT key INTO v_unknown_key
  FROM jsonb_object_keys(p_patch) AS key
  WHERE NOT (key = ANY(v_allowed_keys))
  LIMIT 1;
  IF v_unknown_key IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY', 'key', v_unknown_key);
  END IF;

  SELECT key INTO v_invalid_key
  FROM jsonb_object_keys(p_patch) AS key
  WHERE jsonb_typeof(p_patch -> key) NOT IN ('string', 'null')
  LIMIT 1;
  IF v_invalid_key IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PATCH_VALUE', 'key', v_invalid_key);
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles p
  WHERE p.user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  IF v_profile.is_active IS NOT TRUE OR v_profile.account_status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE');
  END IF;

  IF v_profile.profile_completion_status <> 'IN_PROGRESS' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_COMPLETION_NOT_REQUIRED');
  END IF;

  IF p_expected_version IS NULL
     OR COALESCE(v_profile.profile_completion_version, 1) <> p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'VERSION_CONFLICT',
      'current_version', COALESCE(v_profile.profile_completion_version, 1)
    );
  END IF;

  v_merged := to_jsonb(v_profile) || p_patch;
  v_full_name := NULLIF(btrim(COALESCE(v_merged ->> 'full_name', '')), '');
  v_organization := NULLIF(btrim(COALESCE(v_merged ->> 'organization', '')), '');
  v_position := NULLIF(btrim(COALESCE(v_merged ->> 'position', '')), '');
  BEGIN
    v_phone_verified_at := NULLIF(v_merged ->> 'phone_verified_at', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_phone_verified_at := NULL;
  END;

  IF p_mark_complete AND (
       v_full_name IS NULL
       OR v_organization IS NULL
       OR v_position IS NULL
       OR v_phone_verified_at IS NULL
     ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'COMPLETION_REQUIREMENTS_NOT_MET',
      'missing', jsonb_build_object(
        'full_name', v_full_name IS NULL,
        'organization', v_organization IS NULL,
        'position', v_position IS NULL,
        'phone_verified_at', v_phone_verified_at IS NULL
      )
    );
  END IF;

  PERFORM set_config('app.profile_completion_write', 'true', true);

  UPDATE public.profiles p
  SET full_name = CASE WHEN p_patch ? 'full_name' THEN p_patch ->> 'full_name' ELSE p.full_name END,
      organization = CASE WHEN p_patch ? 'organization' THEN p_patch ->> 'organization' ELSE p.organization END,
      position = CASE WHEN p_patch ? 'position' THEN p_patch ->> 'position' ELSE p.position END,
      department = CASE WHEN p_patch ? 'department' THEN p_patch ->> 'department' ELSE p.department END,
      employee_id = CASE WHEN p_patch ? 'employee_id' THEN p_patch ->> 'employee_id' ELSE p.employee_id END,
      city = CASE WHEN p_patch ? 'city' THEN p_patch ->> 'city' ELSE p.city END,
      location = CASE WHEN p_patch ? 'location' THEN p_patch ->> 'location' ELSE p.location END,
      bio = CASE WHEN p_patch ? 'bio' THEN p_patch ->> 'bio' ELSE p.bio END,
      website = CASE WHEN p_patch ? 'website' THEN p_patch ->> 'website' ELSE p.website END,
      linkedin_url = CASE WHEN p_patch ? 'linkedin_url' THEN p_patch ->> 'linkedin_url' ELSE p.linkedin_url END,
      profile_completion_status = CASE WHEN p_mark_complete THEN 'COMPLETE' ELSE 'IN_PROGRESS' END,
      profile_completion_version = COALESCE(p.profile_completion_version, 1) + 1,
      updated_at = clock_timestamp()
  WHERE p.user_id = v_uid
  RETURNING p.profile_completion_version INTO v_new_version;

  PERFORM set_config('app.profile_completion_write', 'false', true);

  IF p_mark_complete THEN
    INSERT INTO public.security_audit_events (
      user_id, actor_user_id, target_user_id,
      event_type, event_category, severity, result, metadata
    ) VALUES (
      v_uid, v_uid, v_uid,
      'profile_completion_completed', 'auth', 'info', 'success',
      jsonb_build_object('profile_completion_version', v_new_version)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'new_version', v_new_version,
    'profile_completion_status', CASE WHEN p_mark_complete THEN 'COMPLETE' ELSE 'IN_PROGRESS' END
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.profile_completion_write', 'false', true);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_profile_completion_state()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.get_my_profile_completion_state();
$$;

CREATE OR REPLACE FUNCTION public.save_my_profile_completion(
  p_patch jsonb,
  p_expected_version bigint,
  p_mark_complete boolean
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.save_my_profile_completion($1, $2, $3);
$$;

REVOKE ALL ON FUNCTION private.get_my_profile_completion_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.save_my_profile_completion(jsonb, bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_my_profile_completion_state() TO service_role;
GRANT EXECUTE ON FUNCTION private.save_my_profile_completion(jsonb, bigint, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.get_my_profile_completion_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_completion_state() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) TO authenticated, service_role;

-- Extend the canonical account lifecycle service with explicit public-registration
-- approval/rejection transitions. This keeps approval in User Management rather
-- than allowing ad-hoc direct profile updates.
CREATE OR REPLACE FUNCTION private.admin_set_user_lifecycle_service(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_session_id uuid,
  p_action text,
  p_expected_version bigint,
  p_change_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_action text := upper(trim(COALESCE(p_action, '')));
  v_reason text := NULLIF(trim(COALESCE(p_change_reason, '')), '');
  v_actor record;
  v_target record;
  v_other_admins integer := 0;
  v_other_security_admins integer := 0;
  v_new_status text;
  v_new_active boolean;
  v_new_version bigint;
  v_event_type text;
  v_event_severity text := 'warning';
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;
  IF p_actor_user_id = p_target_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SELF_CHANGE_FORBIDDEN');
  END IF;
  IF v_action NOT IN ('SUSPEND', 'REACTIVATE', 'APPROVE_REGISTRATION', 'REJECT_REGISTRATION') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_expected_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EXPECTED_VERSION_REQUIRED');
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_REQUIRED');
  END IF;
  IF length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_TOO_LONG');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = p_session_id AND s.user_id = p_actor_user_id
      AND (s.not_after IS NULL OR s.not_after > clock_timestamp())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT p.user_id, p.is_admin, p.is_security_admin, p.is_active, p.account_status
    INTO v_actor
  FROM public.profiles p
  WHERE p.user_id = p_actor_user_id;

  IF NOT FOUND OR v_actor.is_admin IS NOT TRUE OR v_actor.is_active IS NOT TRUE OR v_actor.account_status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  END IF;

  PERFORM pg_advisory_xact_lock(987654323);

  SELECT p.user_id, p.full_name, p.email, p.is_admin, p.is_security_admin,
         p.is_active, p.account_status, p.registration_source,
         COALESCE(p.account_lifecycle_version, 1) AS account_lifecycle_version
    INTO v_target
  FROM public.profiles p
  WHERE p.user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  END IF;

  IF v_target.account_lifecycle_version <> p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'VERSION_CONFLICT',
      'current_version', v_target.account_lifecycle_version
    );
  END IF;

  IF (v_target.is_admin IS TRUE OR v_target.is_security_admin IS TRUE)
     AND v_actor.is_security_admin IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRIVILEGED_TARGET_REQUIRES_SECURITY_ADMIN');
  END IF;

  IF v_action IN ('APPROVE_REGISTRATION', 'REJECT_REGISTRATION') THEN
    IF v_target.registration_source IS DISTINCT FROM 'public_phone_registration' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REGISTRATION_SOURCE_INVALID');
    END IF;
    IF v_target.account_status <> 'PENDING_ADMIN_APPROVAL' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION', 'current_status', v_target.account_status);
    END IF;

    IF v_action = 'APPROVE_REGISTRATION' THEN
      v_new_status := 'ACTIVE';
      v_new_active := true;
      v_event_type := 'registration_approved_by_admin';
      v_event_severity := 'info';
    ELSE
      v_new_status := 'REJECTED';
      v_new_active := false;
      v_event_type := 'registration_rejected_by_admin';
      v_event_severity := 'warning';
    END IF;

  ELSIF v_action = 'SUSPEND' THEN
    IF v_target.account_status = 'SUSPENDED' AND v_target.is_active IS FALSE THEN
      RETURN jsonb_build_object('ok', true, 'already_in_state', true, 'new_status', 'SUSPENDED', 'new_version', v_target.account_lifecycle_version);
    END IF;
    IF v_target.account_status <> 'ACTIVE' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION', 'current_status', v_target.account_status);
    END IF;

    IF v_target.is_admin IS TRUE THEN
      SELECT count(*) INTO v_other_admins
      FROM public.profiles p
      WHERE p.is_admin IS TRUE
        AND p.is_active IS TRUE
        AND p.account_status = 'ACTIVE'
        AND p.user_id <> p_target_user_id;
      IF v_other_admins = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'LAST_ADMIN_FORBIDDEN');
      END IF;
    END IF;

    IF v_target.is_security_admin IS TRUE THEN
      SELECT count(*) INTO v_other_security_admins
      FROM public.profiles p
      WHERE p.is_security_admin IS TRUE
        AND p.is_active IS TRUE
        AND p.account_status = 'ACTIVE'
        AND p.user_id <> p_target_user_id;
      IF v_other_security_admins = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'LAST_SECURITY_ADMIN_FORBIDDEN');
      END IF;
    END IF;

    v_new_status := 'SUSPENDED';
    v_new_active := false;
    v_event_type := 'admin_account_suspended';
  ELSE
    IF v_target.account_status = 'ACTIVE' AND v_target.is_active IS TRUE THEN
      RETURN jsonb_build_object('ok', true, 'already_in_state', true, 'new_status', 'ACTIVE', 'new_version', v_target.account_lifecycle_version);
    END IF;
    IF v_target.account_status <> 'SUSPENDED' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION', 'current_status', v_target.account_status);
    END IF;
    v_new_status := 'ACTIVE';
    v_new_active := true;
    v_event_type := 'admin_account_reactivated';
  END IF;

  v_new_version := v_target.account_lifecycle_version + 1;

  PERFORM set_config('app.account_lifecycle_write', 'true', true);

  UPDATE public.profiles
  SET account_status = v_new_status,
      is_active = v_new_active,
      account_lifecycle_version = v_new_version,
      account_status_changed_at = clock_timestamp(),
      account_status_changed_by = p_actor_user_id
  WHERE user_id = p_target_user_id;

  PERFORM set_config('app.account_lifecycle_write', 'false', true);

  INSERT INTO public.account_lifecycle_history (
    target_user_id, actor_user_id,
    old_status, new_status,
    old_is_active, new_is_active,
    old_version, new_version,
    action, change_reason,
    session_id
  ) VALUES (
    p_target_user_id, p_actor_user_id,
    v_target.account_status, v_new_status,
    v_target.is_active, v_new_active,
    v_target.account_lifecycle_version, v_new_version,
    v_action, v_reason,
    p_session_id
  );

  INSERT INTO public.security_audit_events (
    user_id, actor_user_id, target_user_id,
    event_type, event_category, severity,
    session_id, result, metadata
  ) VALUES (
    p_actor_user_id, p_actor_user_id, p_target_user_id,
    v_event_type,
    CASE WHEN v_action IN ('APPROVE_REGISTRATION', 'REJECT_REGISTRATION') THEN 'auth' ELSE 'access' END,
    v_event_severity,
    p_session_id, 'success',
    public.sanitize_audit_metadata(jsonb_build_object(
      'action', v_action,
      'reason', v_reason,
      'old_status', v_target.account_status,
      'new_status', v_new_status,
      'registration_source', v_target.registration_source,
      'new_version', v_new_version
    ))
  );

  IF v_action IN ('SUSPEND', 'REJECT_REGISTRATION') THEN
    PERFORM public.revoke_all_sessions(p_target_user_id);
  ELSE
    PERFORM public.ensure_default_calendars_for_user(p_target_user_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'new_status', v_new_status,
    'new_version', v_new_version
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.account_lifecycle_write', 'false', true);
  PERFORM set_config('app.profile_completion_write', 'false', true);
  RAISE;
END;
$$;

NOTIFY pgrst, 'reload schema';
