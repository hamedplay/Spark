/*
# Phase 1 Amendment 4: Final Canonical Hardening

## 1. is_current_security_admin: STABLE, exact checks, grant to authenticated
## 2. Split readiness: check_phone_login_dependencies_ready (no phone_login dependency)
## 3. security_role_version column + optimistic concurrency in set_user_security_admin
## 4. Advisory lock for security admin role changes (race prevention)
## 5. Target eligibility for promotion
## 6. security_admin_role_history table (append-only)
## 7. write_denied_audit helper
## 8. Remove change_reason from audit metadata
## 9. NOT NULL on canonical columns
## 10. Proper integer validation using numeric trunc
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. is_current_security_admin: STABLE, exact, grant to authenticated
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_current_security_admin()
RETURNS boolean
SET search_path = ''
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND is_security_admin IS TRUE
      AND is_active IS TRUE
      AND account_status = 'ACTIVE'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_current_security_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_current_security_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_current_security_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_security_admin() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2a. check_phone_login_dependencies_ready (no phone_login dependency)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_phone_login_dependencies_ready()
RETURNS boolean
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_provider_id text;
  v_provider_uuid uuid;
  v_provider_active boolean;
  v_template_active boolean;
  v_template_has_otp boolean;
  v_template_audience text;
  v_origins text;
  v_hook_confirmed boolean;
  v_pepper_proxy boolean;
BEGIN
  -- 1. SMS Provider selected, valid UUID, and active
  SELECT value INTO v_provider_id
  FROM public.system_config
  WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

  IF v_provider_id IS NULL OR btrim(v_provider_id) = '' THEN
    RETURN false;
  END IF;

  BEGIN
    v_provider_uuid := v_provider_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  SELECT COALESCE(is_active, false) INTO v_provider_active
  FROM public.sms_providers
  WHERE id = v_provider_uuid LIMIT 1;

  IF NOT COALESCE(v_provider_active, false) THEN
    RETURN false;
  END IF;

  -- 2. Template: category='auth', event_type='login_otp', audience='all', is_active=true, body has {{otp}}
  SELECT COALESCE(is_active, false), COALESCE(body LIKE '%{{otp}}%', false), COALESCE(audience, '')
  INTO v_template_active, v_template_has_otp, v_template_audience
  FROM public.sms_templates
  WHERE category = 'auth' AND event_type = 'login_otp'
  LIMIT 1;

  IF NOT COALESCE(v_template_active, false) OR NOT COALESCE(v_template_has_otp, false) THEN
    RETURN false;
  END IF;

  IF COALESCE(v_template_audience, '') <> 'all' THEN
    RETURN false;
  END IF;

  -- 3. Allowed origin configured and non-empty
  SELECT value INTO v_origins
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1;

  IF v_origins IS NULL OR btrim(v_origins) = '' THEN
    RETURN false;
  END IF;

  -- 4. Hook proxy ready
  SELECT COALESCE(value = 'true', false) INTO v_hook_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed' LIMIT 1;

  IF NOT COALESCE(v_hook_confirmed, false) THEN
    RETURN false;
  END IF;

  -- 5. Pepper proxy ready (non-sensitive boolean)
  SELECT COALESCE(value = 'true', false) INTO v_pepper_proxy
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_rate_limit_pepper_configured' LIMIT 1;

  IF NOT COALESCE(v_pepper_proxy, false) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_phone_login_dependencies_ready() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_phone_login_dependencies_ready() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_phone_login_dependencies_ready() FROM authenticated;

-- Keep old function as wrapper for backward compat
CREATE OR REPLACE FUNCTION public.check_phone_login_readiness()
RETURNS boolean
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT COALESCE(phone_login, false) INTO v_enabled
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN false;
  END IF;
  RETURN public.check_phone_login_dependencies_ready();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_phone_login_readiness() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_phone_login_readiness() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_phone_login_readiness() FROM authenticated;

-- 2b. get_public_login_methods: effective = desired AND dependencies_ready
CREATE OR REPLACE FUNCTION public.get_public_login_methods()
RETURNS TABLE (
  username_login boolean,
  email_login boolean,
  phone_login boolean
)
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_row public.auth_security_settings%ROWTYPE;
  v_deps_ready boolean := false;
BEGIN
  SELECT * INTO v_row
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT true, true, false;
    RETURN;
  END IF;

  v_deps_ready := public.check_phone_login_dependencies_ready();

  RETURN QUERY SELECT
    v_row.username_login,
    v_row.email_login,
    (v_row.phone_login AND v_deps_ready);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_login_methods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_login_methods() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_login_methods() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. security_role_version column on profiles
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='security_role_version'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN security_role_version bigint NOT NULL DEFAULT 1;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3b. Protect security_role_version in guard triggers
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_security_admin boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    -- For general protected fields, is_admin is still sufficient
    IF NOT public.is_current_user_admin() THEN
      IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
      OR NEW.can_broadcast IS DISTINCT FROM OLD.can_broadcast
      OR NEW.organization IS DISTINCT FROM OLD.organization
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
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
      OR NEW.position IS DISTINCT FROM OLD.position
      OR NEW.department IS DISTINCT FROM OLD.department
      OR (NEW.username IS DISTINCT FROM OLD.username
          AND NOT (OLD.username IS NULL AND NEW.username IS NOT NULL))
      OR (NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id
          AND NOT (OLD.telegram_chat_id IS NOT NULL AND NEW.telegram_chat_id IS NULL))
      THEN
        RAISE EXCEPTION 'Not allowed to modify protected profile fields';
      END IF;
    END IF;

    -- For security columns, is_admin alone is NOT sufficient — need is_security_admin
    SELECT is_security_admin IS TRUE AND is_active IS TRUE AND account_status = 'ACTIVE'
    INTO v_is_security_admin
    FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

    -- Block security column changes unless actor is security_admin
    -- Also block self-modification of is_security_admin
    IF NOT v_is_security_admin OR auth.uid() = NEW.user_id THEN
      IF NEW.account_status IS DISTINCT FROM OLD.account_status
      OR NEW.profile_completion_status IS DISTINCT FROM OLD.profile_completion_status
      OR NEW.mfa_enrollment_required IS DISTINCT FROM OLD.mfa_enrollment_required
      OR NEW.normalized_username IS DISTINCT FROM OLD.normalized_username
      OR NEW.normalized_email IS DISTINCT FROM OLD.normalized_email
      OR NEW.normalized_phone IS DISTINCT FROM OLD.normalized_phone
      OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at
      OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at
      OR NEW.is_security_admin IS DISTINCT FROM OLD.is_security_admin
      OR NEW.security_role_version IS DISTINCT FROM OLD.security_role_version
      THEN
        RAISE EXCEPTION 'Not allowed to modify security profile fields';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_protected_profile_fields_insert()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_current_user_admin() THEN
    NEW.account_status := 'PHONE_UNVERIFIED';
    NEW.profile_completion_status := 'NOT_STARTED';
    NEW.mfa_enrollment_required := false;
    NEW.is_security_admin := false;
    NEW.security_role_version := 1;
    NEW.email_verified_at := NULL;
    NEW.phone_verified_at := NULL;
    NEW.is_admin := false;
    NEW.is_active := false;
    NEW.can_broadcast := false;
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Cannot create profile for another user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. security_admin_role_history table (append-only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.security_admin_role_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_user_id uuid NOT NULL,
  actor_user_id uuid,
  old_value boolean,
  new_value boolean,
  old_version bigint,
  new_version bigint,
  session_id uuid,
  request_id uuid,
  change_reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_admin_role_history ENABLE ROW LEVEL SECURITY;

-- No policies: nobody can read via RLS except security_admin
CREATE POLICY "security_admins_read_role_history"
  ON public.security_admin_role_history FOR SELECT
  TO authenticated
  USING (public.is_current_security_admin());

REVOKE ALL ON public.security_admin_role_history FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.security_admin_role_history FROM authenticated;
GRANT SELECT ON public.security_admin_role_history TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. write_denied_audit helper (backend-only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.write_denied_audit(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_event_type text,
  p_error_code text,
  p_target_user_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS void
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.security_audit_events (
    actor_user_id, target_user_id, event_type, event_category, severity,
    session_id, request_id, result, error_code, metadata
  ) VALUES (
    p_actor_user_id, p_target_user_id, p_event_type, 'security', 'warning',
    p_session_id, p_request_id, 'denied', p_error_code,
    '{}'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.write_denied_audit(uuid, uuid, text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.write_denied_audit(uuid, uuid, text, text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.write_denied_audit(uuid, uuid, text, text, uuid, uuid) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. NOT NULL on canonical columns (all NULLs already backfilled)
-- ═══════════════════════════════════════════════════════════════════════════

-- Safety backfill (should be no-ops, but ensure no NULLs remain)
UPDATE public.profiles SET account_status = 'ACTIVE'
WHERE account_status IS NULL AND COALESCE(is_active, false) = true;
UPDATE public.profiles SET account_status = 'SUSPENDED'
WHERE account_status IS NULL AND COALESCE(is_active, false) = false;
UPDATE public.profiles SET profile_completion_status = 'COMPLETE'
WHERE profile_completion_status IS NULL;
UPDATE public.profiles SET is_security_admin = false
WHERE is_security_admin IS NULL;
UPDATE public.profiles SET mfa_enrollment_required = false
WHERE mfa_enrollment_required IS NULL;

ALTER TABLE public.profiles ALTER COLUMN account_status SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN profile_completion_status SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN is_security_admin SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN mfa_enrollment_required SET NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4,5,6,7,8. Redefine set_user_security_admin with lock, version, eligibility
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_user_security_admin(
  p_target_user_id uuid,
  p_new_value boolean,
  p_expected_version integer,
  p_change_reason text DEFAULT NULL
)
RETURNS jsonb
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_request_id uuid;
  v_is_security_admin boolean := false;
  v_is_active boolean := false;
  v_account_status text;
  v_target_rec record;
  v_sec_admin_count integer;
  v_stepup_grant public.session_security_grants%ROWTYPE;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
  v_truncated_reason text;
  v_before_state jsonb;
  v_after_state jsonb;
BEGIN
  -- 1. Must have valid session
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- 2. Extract session_id, reject if NULL
  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  v_request_id := NULLIF(v_jwt ->> 'request_id', '')::uuid;

  -- 3. Must be security_admin, active, account_status = 'ACTIVE'
  SELECT is_security_admin IS TRUE, is_active IS TRUE, account_status
  INTO v_is_security_admin, v_is_active, v_account_status
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND OR NOT v_is_security_admin OR NOT v_is_active OR v_account_status != 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- 4. Can't change own is_security_admin
  IF p_target_user_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_CHANGE_OWN_SECURITY_ADMIN');
  END IF;

  -- 5. Take advisory lock for security admin role changes
  PERFORM pg_advisory_xact_lock(987654321);

  -- 6. Re-check actor after lock
  SELECT is_security_admin IS TRUE AND is_active IS TRUE AND account_status = 'ACTIVE'
  INTO v_is_security_admin
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT COALESCE(v_is_security_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- 7. Read target with FOR UPDATE (locked within transaction)
  SELECT user_id, is_security_admin, is_active, account_status, security_role_version
  INTO v_target_rec
  FROM public.profiles
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  END IF;

  -- 8. Target eligibility: must be active and ACTIVE
  IF NOT (v_target_rec.is_active IS TRUE AND v_target_rec.account_status = 'ACTIVE') THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
      'TARGET_NOT_ELIGIBLE', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_ELIGIBLE');
  END IF;

  -- 9. Version check (optimistic concurrency)
  IF v_target_rec.security_role_version != p_expected_version THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
      'VERSION_CONFLICT', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT',
      'current_version', v_target_rec.security_role_version);
  END IF;

  -- 10. No-op check
  IF v_target_rec.is_security_admin = p_new_value THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
      'NO_EFFECTIVE_CHANGE', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
  END IF;

  -- 11. If demoting, check we won't lose the last security admin
  IF p_new_value = false AND v_target_rec.is_security_admin = true THEN
    SELECT COUNT(*) INTO v_sec_admin_count
    FROM public.profiles
    WHERE is_security_admin IS TRUE
      AND is_active IS TRUE
      AND account_status = 'ACTIVE';

    IF v_sec_admin_count <= 1 THEN
      PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
        'CANNOT_REMOVE_LAST_SECURITY_ADMIN', p_target_user_id, v_request_id);
      RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_REMOVE_LAST_SECURITY_ADMIN');
    END IF;
  END IF;

  -- 12. Validate step-up grant
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= now() THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
      'SESSION_EXPIRED', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED');
  END IF;

  SELECT * INTO v_stepup_grant
  FROM public.session_security_grants
  WHERE user_id = v_uid
    AND session_id = v_session_id
    AND grant_type = 'mfa_stepup'
    AND purpose = 'account_security_change'
    AND factor_type IN ('totp', 'bale', 'email', 'recovery_code')
    AND assurance_level IN ('aal2', 'custom_mfa')
    AND consumed_at IS NULL
    AND issued_at <= now()
    AND issued_at >= now() - interval '5 minutes'
    AND expires_at > now()
  ORDER BY issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
      'STEPUP_REQUIRED', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  -- 13. Consume grant
  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_stepup_grant.id;

  -- 14. Capture before state
  v_before_state := jsonb_build_object(
    'is_security_admin', v_target_rec.is_security_admin,
    'security_role_version', v_target_rec.security_role_version
  );

  -- 15. Apply change + increment version
  UPDATE public.profiles
  SET is_security_admin = p_new_value,
      security_role_version = v_target_rec.security_role_version + 1
  WHERE user_id = p_target_user_id;

  -- 16. Capture after state
  v_after_state := jsonb_build_object(
    'is_security_admin', p_new_value,
    'security_role_version', v_target_rec.security_role_version + 1
  );

  -- 17. Truncate change_reason
  v_truncated_reason := CASE
    WHEN p_change_reason IS NOT NULL AND length(p_change_reason) > 500
    THEN left(p_change_reason, 500)
    ELSE p_change_reason
  END;

  -- 18. Write to role history (append-only, backend-only via SECURITY DEFINER)
  INSERT INTO public.security_admin_role_history (
    target_user_id, actor_user_id, old_value, new_value,
    old_version, new_version, session_id, request_id, change_reason
  ) VALUES (
    p_target_user_id, v_uid, v_target_rec.is_security_admin, p_new_value,
    v_target_rec.security_role_version, v_target_rec.security_role_version + 1,
    v_session_id, v_request_id, v_truncated_reason
  );

  -- 19. Audit event (no change_reason in metadata)
  INSERT INTO public.security_audit_events (
    user_id, actor_user_id, target_user_id, event_type, event_category, severity,
    session_id, request_id, before_state, after_state, result, metadata
  ) VALUES (
    v_uid, v_uid, p_target_user_id, 'security_admin_role_changed', 'access', 'info',
    v_session_id, v_request_id,
    public.sanitize_audit_metadata(v_before_state),
    public.sanitize_audit_metadata(v_after_state),
    'success',
    jsonb_build_object(
      'change_reason_present', p_change_reason IS NOT NULL
    )
  );

  RETURN jsonb_build_object('ok', true,
    'new_version', v_target_rec.security_role_version + 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_security_admin(uuid, boolean, integer, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3,7,8,10. Redefine set_auth_security_settings_patch
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_auth_security_settings_patch(
  p_expected_version integer,
  p_patch jsonb,
  p_change_reason text DEFAULT NULL
)
RETURNS jsonb
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_request_id uuid;
  v_account_status text;
  v_is_active boolean := false;
  v_is_security_admin boolean := false;
  v_current public.auth_security_settings%ROWTYPE;
  v_new public.auth_security_settings%ROWTYPE;
  v_new_version integer;
  v_stepup_grant public.session_security_grants%ROWTYPE;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
  v_before_state jsonb;
  v_after_state jsonb;
  v_key text;
  v_value jsonb;
  v_allowed_keys text[] := ARRAY[
    'username_login', 'email_login', 'phone_login', 'mfa_policy',
    'registration_enabled', 'registration_requires_admin_approval', 'require_profile_completion',
    'allow_totp_mfa', 'allow_bale_mfa', 'allow_email_mfa', 'allow_recovery_codes',
    'session_idle_timeout_minutes', 'session_absolute_lifetime_minutes', 'max_active_sessions',
    'lock_threshold', 'lock_duration_minutes', 'recovery_enabled'
  ];
  v_num_val numeric;
  v_int_val integer;
  v_truncated_reason text;
  v_phone_was_enabled boolean := false;
  v_mfa_factors_active boolean := false;
BEGIN
  -- 1. Must have valid session
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- 2. Extract session_id, reject if NULL
  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  v_request_id := NULLIF(v_jwt ->> 'request_id', '')::uuid;

  -- 3. Must be security_admin, active, account_status = 'ACTIVE' (exact, no COALESCE)
  SELECT account_status, is_active IS TRUE, is_security_admin IS TRUE
  INTO v_account_status, v_is_active, v_is_security_admin
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF v_account_status != 'ACTIVE' OR NOT v_is_active OR NOT v_is_security_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- 4. Validate patch structure
  IF p_patch IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PATCH_REQUIRED');
  END IF;
  IF jsonb_typeof(p_patch) != 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PATCH_MUST_BE_OBJECT');
  END IF;
  IF p_patch = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPTY_PATCH');
  END IF;

  -- 5. Load current settings (FOR UPDATE)
  SELECT * INTO v_current
  FROM public.auth_security_settings
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  -- 6. Optimistic concurrency
  IF v_current.settings_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT',
      'current_version', v_current.settings_version);
  END IF;

  -- 7. Validate patch keys and values
  v_new := v_current;
  v_phone_was_enabled := v_current.phone_login;

  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY', 'key', v_key);
    END IF;

    CASE v_key
      WHEN 'username_login' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.username_login := (v_value)::boolean;

      WHEN 'email_login' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.email_login := (v_value)::boolean;

      WHEN 'phone_login' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.phone_login := (v_value)::boolean;

      WHEN 'mfa_policy' THEN
        IF jsonb_typeof(v_value) != 'string' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        IF v_value #>> '{}' NOT IN ('disabled', 'optional', 'required') THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_VALUE', 'key', v_key);
        END IF;
        v_new.mfa_policy := v_value #>> '{}';

      WHEN 'registration_enabled' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.registration_enabled := (v_value)::boolean;

      WHEN 'registration_requires_admin_approval' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.registration_requires_admin_approval := (v_value)::boolean;

      WHEN 'require_profile_completion' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.require_profile_completion := (v_value)::boolean;

      WHEN 'allow_totp_mfa' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.allow_totp_mfa := (v_value)::boolean;

      WHEN 'allow_bale_mfa' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.allow_bale_mfa := (v_value)::boolean;

      WHEN 'allow_email_mfa' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.allow_email_mfa := (v_value)::boolean;

      WHEN 'allow_recovery_codes' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.allow_recovery_codes := (v_value)::boolean;

      WHEN 'session_idle_timeout_minutes' THEN
        IF jsonb_typeof(v_value) != 'number' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        BEGIN
          v_num_val := (v_value #>> '{}')::numeric;
        EXCEPTION WHEN others THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END;
        IF trunc(v_num_val) != v_num_val THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_int_val := v_num_val::integer;
        IF v_int_val < 1 OR v_int_val > 10080 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'key', v_key);
        END IF;
        v_new.session_idle_timeout_minutes := v_int_val;

      WHEN 'session_absolute_lifetime_minutes' THEN
        IF jsonb_typeof(v_value) != 'number' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        BEGIN
          v_num_val := (v_value #>> '{}')::numeric;
        EXCEPTION WHEN others THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END;
        IF trunc(v_num_val) != v_num_val THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_int_val := v_num_val::integer;
        IF v_int_val < 1 OR v_int_val > 43200 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'key', v_key);
        END IF;
        v_new.session_absolute_lifetime_minutes := v_int_val;

      WHEN 'max_active_sessions' THEN
        IF jsonb_typeof(v_value) != 'number' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        BEGIN
          v_num_val := (v_value #>> '{}')::numeric;
        EXCEPTION WHEN others THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END;
        IF trunc(v_num_val) != v_num_val THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_int_val := v_num_val::integer;
        IF v_int_val < 1 OR v_int_val > 100 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'key', v_key);
        END IF;
        v_new.max_active_sessions := v_int_val;

      WHEN 'lock_threshold' THEN
        IF jsonb_typeof(v_value) != 'number' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        BEGIN
          v_num_val := (v_value #>> '{}')::numeric;
        EXCEPTION WHEN others THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END;
        IF trunc(v_num_val) != v_num_val THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_int_val := v_num_val::integer;
        IF v_int_val < 1 OR v_int_val > 50 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'key', v_key);
        END IF;
        v_new.lock_threshold := v_int_val;

      WHEN 'lock_duration_minutes' THEN
        IF jsonb_typeof(v_value) != 'number' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        BEGIN
          v_num_val := (v_value #>> '{}')::numeric;
        EXCEPTION WHEN others THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END;
        IF trunc(v_num_val) != v_num_val THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_int_val := v_num_val::integer;
        IF v_int_val < 1 OR v_int_val > 1440 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'key', v_key);
        END IF;
        v_new.lock_duration_minutes := v_int_val;

      WHEN 'recovery_enabled' THEN
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.recovery_enabled := (v_value)::boolean;

      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY', 'key', v_key);
    END CASE;
  END LOOP;

  -- 8. No effective change
  IF v_new.username_login = v_current.username_login
     AND v_new.email_login = v_current.email_login
     AND v_new.phone_login = v_current.phone_login
     AND v_new.mfa_policy = v_current.mfa_policy
     AND v_new.registration_enabled = v_current.registration_enabled
     AND v_new.registration_requires_admin_approval = v_current.registration_requires_admin_approval
     AND v_new.require_profile_completion = v_current.require_profile_completion
     AND v_new.allow_totp_mfa = v_current.allow_totp_mfa
     AND v_new.allow_bale_mfa = v_current.allow_bale_mfa
     AND v_new.allow_email_mfa = v_current.allow_email_mfa
     AND v_new.allow_recovery_codes = v_current.allow_recovery_codes
     AND v_new.session_idle_timeout_minutes = v_current.session_idle_timeout_minutes
     AND v_new.session_absolute_lifetime_minutes = v_current.session_absolute_lifetime_minutes
     AND v_new.max_active_sessions = v_current.max_active_sessions
     AND v_new.lock_threshold = v_current.lock_threshold
     AND v_new.lock_duration_minutes = v_current.lock_duration_minutes
     AND v_new.recovery_enabled = v_current.recovery_enabled
  THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'NO_EFFECTIVE_CHANGE', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
  END IF;

  -- 9. At least one login method
  IF NOT (v_new.username_login OR v_new.email_login OR v_new.phone_login) THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'NO_LOGIN_METHOD_ENABLED', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LOGIN_METHOD_ENABLED');
  END IF;

  -- 10. MFA dependency
  v_mfa_factors_active := v_new.allow_totp_mfa OR v_new.allow_bale_mfa OR v_new.allow_email_mfa;
  IF v_new.mfa_policy = 'required' AND NOT v_mfa_factors_active THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'MFA_REQUIRED_WITHOUT_FACTOR', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_REQUIRED_WITHOUT_FACTOR');
  END IF;

  -- 11. Session policy dependencies
  IF v_new.session_idle_timeout_minutes > v_new.session_absolute_lifetime_minutes THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'INVALID_SESSION_POLICY', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION_POLICY');
  END IF;
  IF v_new.session_idle_timeout_minutes < 1 OR v_new.session_absolute_lifetime_minutes < 1 THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'INVALID_SESSION_POLICY', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION_POLICY');
  END IF;
  IF v_new.max_active_sessions < 1 THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'INVALID_SESSION_POLICY', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION_POLICY');
  END IF;

  -- 12. Phone login readiness on enable (uses dependencies only, not phone_login setting)
  IF v_new.phone_login AND NOT v_phone_was_enabled THEN
    IF NOT public.check_phone_login_dependencies_ready() THEN
      PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
        'PHONE_LOGIN_NOT_READY', NULL, v_request_id);
      RETURN jsonb_build_object('ok', false, 'error', 'PHONE_LOGIN_NOT_READY');
    END IF;
  END IF;

  -- 13. Validate session and grant
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= now() THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'SESSION_EXPIRED', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED');
  END IF;

  SELECT * INTO v_stepup_grant
  FROM public.session_security_grants
  WHERE user_id = v_uid
    AND session_id = v_session_id
    AND grant_type = 'mfa_stepup'
    AND purpose = 'auth_settings_change'
    AND factor_type IN ('totp', 'bale', 'email', 'recovery_code')
    AND assurance_level IN ('aal2', 'custom_mfa')
    AND consumed_at IS NULL
    AND issued_at <= now()
    AND issued_at >= now() - interval '5 minutes'
    AND expires_at > now()
  ORDER BY issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'STEPUP_REQUIRED', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  -- 14. Consume grant
  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_stepup_grant.id;

  -- 15. Increment version
  v_new_version := v_current.settings_version + 1;

  -- 16. Truncate change_reason
  v_truncated_reason := CASE
    WHEN p_change_reason IS NOT NULL AND length(p_change_reason) > 500
    THEN left(p_change_reason, 500)
    ELSE p_change_reason
  END;

  -- 17. Capture full before_state
  v_before_state := jsonb_build_object(
    'settings_version', v_current.settings_version,
    'username_login', v_current.username_login,
    'email_login', v_current.email_login,
    'phone_login', v_current.phone_login,
    'mfa_policy', v_current.mfa_policy,
    'registration_enabled', v_current.registration_enabled,
    'registration_requires_admin_approval', v_current.registration_requires_admin_approval,
    'require_profile_completion', v_current.require_profile_completion,
    'allow_totp_mfa', v_current.allow_totp_mfa,
    'allow_bale_mfa', v_current.allow_bale_mfa,
    'allow_email_mfa', v_current.allow_email_mfa,
    'allow_recovery_codes', v_current.allow_recovery_codes,
    'session_idle_timeout_minutes', v_current.session_idle_timeout_minutes,
    'session_absolute_lifetime_minutes', v_current.session_absolute_lifetime_minutes,
    'max_active_sessions', v_current.max_active_sessions,
    'lock_threshold', v_current.lock_threshold,
    'lock_duration_minutes', v_current.lock_duration_minutes,
    'recovery_enabled', v_current.recovery_enabled,
    'config_schema_version', v_current.config_schema_version
  );

  -- 18. Update settings
  UPDATE public.auth_security_settings
  SET settings_version = v_new_version,
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
      lock_threshold = v_new.lock_threshold,
      lock_duration_minutes = v_new.lock_duration_minutes,
      recovery_enabled = v_new.recovery_enabled,
      updated_at = now(),
      updated_by = v_uid
  WHERE id = 1;

  -- 19. Capture full after_state
  v_after_state := jsonb_build_object(
    'settings_version', v_new_version,
    'username_login', v_new.username_login,
    'email_login', v_new.email_login,
    'phone_login', v_new.phone_login,
    'mfa_policy', v_new.mfa_policy,
    'registration_enabled', v_new.registration_enabled,
    'registration_requires_admin_approval', v_new.registration_requires_admin_approval,
    'require_profile_completion', v_new.require_profile_completion,
    'allow_totp_mfa', v_new.allow_totp_mfa,
    'allow_bale_mfa', v_new.allow_bale_mfa,
    'allow_email_mfa', v_new.allow_email_mfa,
    'allow_recovery_codes', v_new.allow_recovery_codes,
    'session_idle_timeout_minutes', v_new.session_idle_timeout_minutes,
    'session_absolute_lifetime_minutes', v_new.session_absolute_lifetime_minutes,
    'max_active_sessions', v_new.max_active_sessions,
    'lock_threshold', v_new.lock_threshold,
    'lock_duration_minutes', v_new.lock_duration_minutes,
    'recovery_enabled', v_new.recovery_enabled,
    'config_schema_version', v_current.config_schema_version
  );

  -- 20. Write to history
  INSERT INTO public.auth_security_settings_history (
    version, username_login, email_login, phone_login, mfa_policy,
    registration_enabled, registration_requires_admin_approval, require_profile_completion,
    allow_totp_mfa, allow_bale_mfa, allow_email_mfa, allow_recovery_codes,
    session_idle_timeout_minutes, session_absolute_lifetime_minutes, max_active_sessions,
    lock_threshold, lock_duration_minutes, recovery_enabled, config_schema_version,
    changed_at, changed_by, change_reason
  ) VALUES (
    v_new_version, v_new.username_login, v_new.email_login, v_new.phone_login, v_new.mfa_policy,
    v_new.registration_enabled, v_new.registration_requires_admin_approval,
    v_new.require_profile_completion, v_new.allow_totp_mfa, v_new.allow_bale_mfa,
    v_new.allow_email_mfa, v_new.allow_recovery_codes,
    v_new.session_idle_timeout_minutes, v_new.session_absolute_lifetime_minutes,
    v_new.max_active_sessions, v_new.lock_threshold, v_new.lock_duration_minutes,
    v_new.recovery_enabled, v_current.config_schema_version,
    now(), v_uid, v_truncated_reason
  );

  -- 21. Audit event (no change_reason in metadata, only presence flag)
  INSERT INTO public.security_audit_events (
    user_id, actor_user_id, event_type, event_category, severity,
    session_id, request_id, before_state, after_state, result, metadata
  ) VALUES (
    v_uid, v_uid, 'auth_security_settings_changed', 'settings_change', 'info',
    v_session_id, v_request_id,
    public.sanitize_audit_metadata(v_before_state),
    public.sanitize_audit_metadata(v_after_state),
    'success',
    jsonb_build_object(
      'change_reason_present', p_change_reason IS NOT NULL
    )
  );

  RETURN jsonb_build_object('ok', true, 'new_version', v_new_version);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings_patch(integer, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings_patch(integer, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_auth_security_settings_patch(integer, jsonb, text) TO authenticated;

-- Legacy wrapper
CREATE OR REPLACE FUNCTION public.set_auth_security_settings(
  p_expected_version integer,
  p_username_login boolean DEFAULT NULL,
  p_email_login boolean DEFAULT NULL,
  p_phone_login boolean DEFAULT NULL,
  p_mfa_policy text DEFAULT NULL,
  p_change_reason text DEFAULT NULL
)
RETURNS jsonb
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_patch jsonb := '{}'::jsonb;
BEGIN
  IF p_username_login IS NOT NULL THEN
    v_patch := v_patch || jsonb_build_object('username_login', p_username_login);
  END IF;
  IF p_email_login IS NOT NULL THEN
    v_patch := v_patch || jsonb_build_object('email_login', p_email_login);
  END IF;
  IF p_phone_login IS NOT NULL THEN
    v_patch := v_patch || jsonb_build_object('phone_login', p_phone_login);
  END IF;
  IF p_mfa_policy IS NOT NULL THEN
    v_patch := v_patch || jsonb_build_object('mfa_policy', p_mfa_policy);
  END IF;
  RETURN public.set_auth_security_settings_patch(p_expected_version, v_patch, p_change_reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) TO authenticated;
