/*
# Phase 1 Amendment 5: Final Blocker Fixes

## 1. Block direct UPDATE of is_security_admin / security_role_version
   - New BEFORE UPDATE OF trigger with SECURITY INVOKER
   - Checks current_user (not auth.uid()) — inside SECURITY DEFINER RPC,
     current_user is 'postgres' (function/table owner), so RPC UPDATE passes
   - Direct PostgREST calls have current_user='authenticated', blocked
   - anon also blocked
   - service_role allowed

## 2. Fix write_denied_audit event_category
   - 'security' is not in the CHECK constraint
   - Map event_type to valid category: settings_change or access
   - Fail-closed: unknown event_type → 'access'

## 3. Session validation before sensitive operations
   - In both RPCs, move session existence + ownership + expiry check
     to right after actor identification and before any locks/lookups
   - SESSION_INVALID: no audit (session unverified)
   - SESSION_EXPIRED: audit with denied
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Trigger to block direct UPDATE of security role columns
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_security_role_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- current_user is the effective role for this statement:
  --   - Direct PostgREST authenticated call: current_user = 'authenticated'
  --   - Direct anon call: current_user = 'anon'
  --   - Inside SECURITY DEFINER set_user_security_admin (owned by postgres): current_user = 'postgres'
  --   - service_role: current_user = 'service_role'
  -- Block authenticated and anon from directly changing these columns
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Direct modification of security role columns is not allowed';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop if exists from prior attempts, then create
DROP TRIGGER IF EXISTS trg_guard_security_role_columns ON public.profiles;
CREATE TRIGGER trg_guard_security_role_columns
  BEFORE UPDATE OF is_security_admin, security_role_version ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_security_role_columns();

REVOKE EXECUTE ON FUNCTION public.guard_security_role_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_security_role_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_security_role_columns() FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Fix write_denied_audit: use valid event_category
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
DECLARE
  v_category text;
BEGIN
  -- Map event_type to a valid event_category per CHECK constraint
  -- Valid categories: auth, mfa, recovery, session, access, account_lock, settings_change
  v_category := CASE
    WHEN p_event_type LIKE 'auth_settings%' THEN 'settings_change'
    WHEN p_event_type LIKE 'security_admin_role%' THEN 'access'
    ELSE 'access'
  END;

  INSERT INTO public.security_audit_events (
    actor_user_id, target_user_id, event_type, event_category, severity,
    session_id, request_id, result, error_code, metadata
  ) VALUES (
    p_actor_user_id, p_target_user_id, p_event_type, v_category, 'warning',
    p_session_id, p_request_id, 'denied', p_error_code,
    '{}'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.write_denied_audit(uuid, uuid, text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.write_denied_audit(uuid, uuid, text, text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.write_denied_audit(uuid, uuid, text, text, uuid, uuid) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Redefine set_user_security_admin: session check first, before locks
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

  -- 5. Session validation BEFORE any locks, target lookup, or grant
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    -- No audit: session is unverified
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= now() THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
      'SESSION_EXPIRED', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED');
  END IF;

  -- 6. Take advisory lock for security admin role changes
  PERFORM pg_advisory_xact_lock(987654321);

  -- 7. Re-check actor after lock
  SELECT is_security_admin IS TRUE AND is_active IS TRUE AND account_status = 'ACTIVE'
  INTO v_is_security_admin
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT COALESCE(v_is_security_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- 8. Read target with FOR UPDATE
  SELECT user_id, is_security_admin, is_active, account_status, security_role_version
  INTO v_target_rec
  FROM public.profiles
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  END IF;

  -- 9. Target eligibility
  IF NOT (v_target_rec.is_active IS TRUE AND v_target_rec.account_status = 'ACTIVE') THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
      'TARGET_NOT_ELIGIBLE', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_ELIGIBLE');
  END IF;

  -- 10. Version check
  IF v_target_rec.security_role_version != p_expected_version THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
      'VERSION_CONFLICT', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT',
      'current_version', v_target_rec.security_role_version);
  END IF;

  -- 11. No-op check
  IF v_target_rec.is_security_admin = p_new_value THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'security_admin_role_change_denied',
      'NO_EFFECTIVE_CHANGE', p_target_user_id, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
  END IF;

  -- 12. Last security admin check
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

  -- 13. Validate step-up grant
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

  -- 14. Consume grant
  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_stepup_grant.id;

  -- 15. Capture before state
  v_before_state := jsonb_build_object(
    'is_security_admin', v_target_rec.is_security_admin,
    'security_role_version', v_target_rec.security_role_version
  );

  -- 16. Apply change + increment version
  -- This UPDATE runs with current_user='postgres' (SECURITY DEFINER),
  -- so trg_guard_security_role_columns allows it
  UPDATE public.profiles
  SET is_security_admin = p_new_value,
      security_role_version = v_target_rec.security_role_version + 1
  WHERE user_id = p_target_user_id;

  -- 17. Capture after state
  v_after_state := jsonb_build_object(
    'is_security_admin', p_new_value,
    'security_role_version', v_target_rec.security_role_version + 1
  );

  -- 18. Truncate change_reason
  v_truncated_reason := CASE
    WHEN p_change_reason IS NOT NULL AND length(p_change_reason) > 500
    THEN left(p_change_reason, 500)
    ELSE p_change_reason
  END;

  -- 19. Write to role history
  INSERT INTO public.security_admin_role_history (
    target_user_id, actor_user_id, old_value, new_value,
    old_version, new_version, session_id, request_id, change_reason
  ) VALUES (
    p_target_user_id, v_uid, v_target_rec.is_security_admin, p_new_value,
    v_target_rec.security_role_version, v_target_rec.security_role_version + 1,
    v_session_id, v_request_id, v_truncated_reason
  );

  -- 20. Audit event
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
-- 3b. Redefine set_auth_security_settings_patch: session check first
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

  -- 3. Must be security_admin, active, account_status = 'ACTIVE'
  SELECT account_status, is_active IS TRUE, is_security_admin IS TRUE
  INTO v_account_status, v_is_active, v_is_security_admin
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF v_account_status != 'ACTIVE' OR NOT v_is_active OR NOT v_is_security_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- 4. Session validation BEFORE any locks, patch validation, or grant
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    -- No audit: session is unverified
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= now() THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'SESSION_EXPIRED', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED');
  END IF;

  -- 5. Validate patch structure
  IF p_patch IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PATCH_REQUIRED');
  END IF;
  IF jsonb_typeof(p_patch) != 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PATCH_MUST_BE_OBJECT');
  END IF;
  IF p_patch = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPTY_PATCH');
  END IF;

  -- 6. Load current settings (FOR UPDATE)
  SELECT * INTO v_current
  FROM public.auth_security_settings
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  -- 7. Optimistic concurrency
  IF v_current.settings_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT',
      'current_version', v_current.settings_version);
  END IF;

  -- 8. Validate patch keys and values
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
        IF jsonb_typeof(v_value) != 'boolean' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_new.lock_threshold := (v_value)::integer;
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

  -- 9. No effective change
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

  -- 10. At least one login method
  IF NOT (v_new.username_login OR v_new.email_login OR v_new.phone_login) THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'NO_LOGIN_METHOD_ENABLED', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LOGIN_METHOD_ENABLED');
  END IF;

  -- 11. MFA dependency
  v_mfa_factors_active := v_new.allow_totp_mfa OR v_new.allow_bale_mfa OR v_new.allow_email_mfa;
  IF v_new.mfa_policy = 'required' AND NOT v_mfa_factors_active THEN
    PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
      'MFA_REQUIRED_WITHOUT_FACTOR', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_REQUIRED_WITHOUT_FACTOR');
  END IF;

  -- 12. Session policy dependencies
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

  -- 13. Phone login readiness on enable
  IF v_new.phone_login AND NOT v_phone_was_enabled THEN
    IF NOT public.check_phone_login_dependencies_ready() THEN
      PERFORM public.write_denied_audit(v_uid, v_session_id, 'auth_settings_change_denied',
        'PHONE_LOGIN_NOT_READY', NULL, v_request_id);
      RETURN jsonb_build_object('ok', false, 'error', 'PHONE_LOGIN_NOT_READY');
    END IF;
  END IF;

  -- 14. Validate step-up grant
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

  -- 15. Consume grant
  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_stepup_grant.id;

  -- 16. Increment version
  v_new_version := v_current.settings_version + 1;

  -- 17. Truncate change_reason
  v_truncated_reason := CASE
    WHEN p_change_reason IS NOT NULL AND length(p_change_reason) > 500
    THEN left(p_change_reason, 500)
    ELSE p_change_reason
  END;

  -- 18. Capture full before_state
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

  -- 19. Update settings
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

  -- 20. Capture full after_state
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

  -- 21. Write to history
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

  -- 22. Audit event
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
