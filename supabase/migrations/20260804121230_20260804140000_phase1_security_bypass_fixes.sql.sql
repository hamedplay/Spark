/*
# Phase 1 Amendment 2: Security Bypass Fixes

## Purpose
Fixes 8 security bypass vulnerabilities from the prior Phase 1 migrations.
Single additive timestamped migration. No data loss, no runtime/UI/edge changes.

## 1. Profile INSERT Fix
- New dedicated `guard_protected_profile_fields_insert()` BEFORE INSERT function
- Does NOT reference OLD.* (which doesn't exist for INSERT)
- Authenticated users: forces security columns to safe defaults, blocks is_admin/is_active spoofing
- Backend (auth.uid() IS NULL): allows explicit values for controlled operations
- Drops broken insert trigger, replaces with new one
- Changes column defaults to PHONE_UNVERIFIED / NOT_STARTED for new records
- Existing backfill unchanged

## 2. Idempotent Security Admin Backfill
- Updates is_admin=true AND is_security_admin IS DISTINCT FROM true → true
- Idempotent, safe to re-run

## 3. Session Security Grant Hardening
- session_id, purpose, factor_type, assurance_level → NOT NULL
- New CHECK: expires_at > issued_at, expires_at <= issued_at + 5min
- New CHECK: assurance_level IN ('aal2', 'custom_mfa')
- RPC rejects NULL session_id with SESSION_REQUIRED before grant lookup
- RPC validates session exists in auth.sessions and belongs to same user
- RPC rejects password_reauth as MFA factor
- Removes NULL=NULL matching for session_id

## 4. Table Privilege Minimization
- REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  from anon AND authenticated on all 4 security tables
- GRANT SELECT only to authenticated (RLS still controls row access)
- Audit remains append-only (no INSERT policy, no INSERT privilege)

## 5. Recursive Sanitizer
- sanitize_audit_metadata rewritten to recurse into nested JSON objects/arrays
- Case-insensitive key matching (lowercases keys before comparison)
- EXECUTE revoked from PUBLIC, anon, authenticated

## 6. Phone Login Readiness Fix
- Removes raw phone_auth_pepper from decision path
- Uses non-sensitive boolean phone_rate_limit_pepper_configured instead
- Fail-closed: invalid UUID → false (not exception)
- Template checks: category='auth', event_type='login_otp', audience='all', is_active=true, body LIKE '%{{otp}}%'
- EXECUTE revoked from PUBLIC, anon, authenticated

## 7. Internal Function GRANT Minimization
- REVOKE EXECUTE on sync_normalized_profile_fields, guard_protected_profile_fields,
  guard_protected_profile_fields_insert, sanitize_audit_metadata, check_phone_login_readiness
  from PUBLIC, anon, authenticated
- Triggers still work (trigger functions execute with table owner privileges)

## 8. Complete Settings Setter
- New `set_auth_security_settings_patch(p_expected_version, p_patch jsonb, p_change_reason)`
- Accepts JSONB patch with whitelisted keys, validates types/ranges/dependencies
- Delegates from existing `set_auth_security_settings` for backward compatibility
- History and Audit capture full before/after snapshot of ALL canonical settings

## Security
- All SECURITY DEFINER functions: SET search_path = ''
- Schema-qualified references
- REVOKE from PUBLIC/anon except public 3-boolean RPC
- No DROP of tables, data, or previous migrations
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Profile INSERT fix: dedicated BEFORE INSERT function
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_protected_profile_fields_insert()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_current_user_admin() THEN
    -- Authenticated non-admin: force security defaults, block protected fields
    NEW.account_status := 'PHONE_UNVERIFIED';
    NEW.profile_completion_status := 'NOT_STARTED';
    NEW.mfa_enrollment_required := false;
    NEW.is_security_admin := false;
    NEW.email_verified_at := NULL;
    NEW.phone_verified_at := NULL;
    NEW.is_admin := false;
    NEW.is_active := false;
    NEW.can_broadcast := false;
    -- normalized_* are handled by sync trigger, but ensure client can't set them
    -- They will be overwritten by the sync trigger anyway
    -- Block user_id spoofing
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Cannot create profile for another user';
    END IF;
  END IF;
  -- Backend (auth.uid() IS NULL): allow explicit values
  RETURN NEW;
END;
$$;

-- Drop broken insert trigger, create new one with dedicated function
DROP TRIGGER IF EXISTS trg_guard_protected_profile_fields_insert ON public.profiles;
CREATE TRIGGER trg_guard_protected_profile_fields_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_protected_profile_fields_insert();

-- Change defaults for new records (does not affect existing data)
ALTER TABLE public.profiles
  ALTER COLUMN account_status SET DEFAULT 'PHONE_UNVERIFIED';
ALTER TABLE public.profiles
  ALTER COLUMN profile_completion_status SET DEFAULT 'NOT_STARTED';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Idempotent security admin backfill
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.profiles
SET is_security_admin = true
WHERE is_admin = true
  AND COALESCE(is_active, false) = true
  AND is_security_admin IS DISTINCT FROM true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Session security grant hardening
-- ═══════════════════════════════════════════════════════════════════════════

-- Set NOT NULL on columns (table is empty, safe to do)
-- First set any existing NULLs to non-NULL defaults (shouldn't be any, but safe)
UPDATE public.session_security_grants SET session_id = '00000000-0000-0000-0000-000000000000'::uuid WHERE session_id IS NULL;
UPDATE public.session_security_grants SET purpose = 'auth_settings_change' WHERE purpose IS NULL;
UPDATE public.session_security_grants SET factor_type = 'totp' WHERE factor_type IS NULL;
UPDATE public.session_security_grants SET assurance_level = 'custom_mfa' WHERE assurance_level IS NULL;

ALTER TABLE public.session_security_grants ALTER COLUMN session_id SET NOT NULL;
ALTER TABLE public.session_security_grants ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE public.session_security_grants ALTER COLUMN factor_type SET NOT NULL;
ALTER TABLE public.session_security_grants ALTER COLUMN assurance_level SET NOT NULL;

-- New CHECK constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_security_grants_expiry_after_issued'
    AND conrelid = 'public.session_security_grants'::regclass
  ) THEN
    ALTER TABLE public.session_security_grants
    ADD CONSTRAINT session_security_grants_expiry_after_issued
    CHECK (expires_at > issued_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_security_grants_max_ttl_5min'
    AND conrelid = 'public.session_security_grants'::regclass
  ) THEN
    ALTER TABLE public.session_security_grants
    ADD CONSTRAINT session_security_grants_max_ttl_5min
    CHECK (expires_at <= issued_at + interval '5 minutes');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_security_grants_assurance_check'
    AND conrelid = 'public.session_security_grants'::regclass
  ) THEN
    ALTER TABLE public.session_security_grants
    ADD CONSTRAINT session_security_grants_assurance_check
    CHECK (assurance_level IN ('aal2', 'custom_mfa'));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Table privilege minimization
-- ═══════════════════════════════════════════════════════════════════════════

-- security_audit_events
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.security_audit_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.security_audit_events FROM authenticated;
GRANT SELECT ON public.security_audit_events TO authenticated;

-- session_security_grants
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.session_security_grants FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.session_security_grants FROM authenticated;
GRANT SELECT ON public.session_security_grants TO authenticated;

-- auth_security_settings
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.auth_security_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.auth_security_settings FROM authenticated;
GRANT SELECT ON public.auth_security_settings TO authenticated;

-- auth_security_settings_history
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.auth_security_settings_history FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.auth_security_settings_history FROM authenticated;
GRANT SELECT ON public.auth_security_settings_history TO authenticated;

-- ip_address must always be NULL on security_audit_events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'security_audit_events_ip_address_null'
    AND conrelid = 'public.security_audit_events'::regclass
  ) THEN
    ALTER TABLE public.security_audit_events
    ADD CONSTRAINT security_audit_events_ip_address_null
    CHECK (ip_address IS NULL);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Recursive sanitizer
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sanitize_audit_metadata(p_metadata jsonb)
RETURNS jsonb
SET search_path = ''
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_secret_keys text[] := ARRAY[
    'password', 'otp', 'otp_code', 'token', 'access_token', 'refresh_token',
    'authorization', 'secret', 'api_key', 'recovery_code'
  ];
BEGIN
  IF p_metadata IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN public.sanitize_jsonb_recursive(p_metadata, v_secret_keys);
END;
$$;

-- Helper: recursive sanitization
CREATE OR REPLACE FUNCTION public.sanitize_jsonb_recursive(p_data jsonb, p_secret_keys text[])
RETURNS jsonb
SET search_path = ''
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_key text;
  v_value jsonb;
  v_lower_key text;
  v_k text;
  v_is_secret boolean;
BEGIN
  IF p_data IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  IF jsonb_typeof(p_data) = 'object' THEN
    FOR v_key, v_value IN SELECT * FROM jsonb_each(p_data) LOOP
      v_lower_key := lower(v_key);
      v_is_secret := false;
      FOREACH v_k IN ARRAY p_secret_keys LOOP
        IF v_lower_key = v_k THEN
          v_is_secret := true;
          EXIT;
        END IF;
      END LOOP;

      IF v_is_secret THEN
        -- Skip this key entirely
        CONTINUE;
      ELSIF jsonb_typeof(v_value) IN ('object', 'array') THEN
        -- Recurse into nested structures
        v_result := v_result || jsonb_build_object(v_key, public.sanitize_jsonb_recursive(v_value, p_secret_keys));
      ELSE
        v_result := v_result || jsonb_build_object(v_key, v_value);
      END IF;
    END LOOP;
    RETURN v_result;

  ELSIF jsonb_typeof(p_data) = 'array' THEN
    -- For arrays, sanitize each element
    SELECT jsonb_agg(public.sanitize_jsonb_recursive(elem, p_secret_keys))
    INTO v_result
    FROM jsonb_array_elements(p_data) AS elem;
    RETURN COALESCE(v_result, '[]'::jsonb);
  ELSE
    -- Scalar value, return as-is
    RETURN p_data;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sanitize_audit_metadata(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sanitize_audit_metadata(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sanitize_audit_metadata(jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.sanitize_jsonb_recursive(jsonb, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sanitize_jsonb_recursive(jsonb, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sanitize_jsonb_recursive(jsonb, text[]) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Phone login readiness fix
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_phone_login_readiness()
RETURNS boolean
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_enabled boolean := false;
  v_provider_id text;
  v_provider_uuid uuid;
  v_provider_active boolean := false;
  v_template_active boolean := false;
  v_template_has_otp boolean := false;
  v_template_audience text;
  v_origins text := '';
  v_hook_confirmed boolean := false;
  v_pepper_proxy boolean := false;
BEGIN
  -- 1. Phone login enabled in canonical settings?
  SELECT COALESCE(phone_login, false) INTO v_enabled
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  IF NOT v_enabled THEN
    RETURN false;
  END IF;

  -- 2. SMS Provider selected, valid UUID, and active?
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

  IF NOT v_provider_active THEN
    RETURN false;
  END IF;

  -- 3. Template: category='auth', event_type='login_otp', audience='all', is_active=true, body has {{otp}}
  SELECT COALESCE(is_active, false), COALESCE(body LIKE '%{{otp}}%', false), COALESCE(audience, '')
  INTO v_template_active, v_template_has_otp, v_template_audience
  FROM public.sms_templates
  WHERE category = 'auth' AND event_type = 'login_otp'
  LIMIT 1;

  IF NOT v_template_active OR NOT v_template_has_otp THEN
    RETURN false;
  END IF;

  IF v_template_audience IS NULL OR v_template_audience <> 'all' THEN
    RETURN false;
  END IF;

  -- 4. Allowed origin configured and non-empty?
  SELECT value INTO v_origins
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1;

  IF v_origins IS NULL OR btrim(v_origins) = '' THEN
    RETURN false;
  END IF;

  -- 5. Hook proxy ready?
  SELECT COALESCE(value = 'true', false) INTO v_hook_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed' LIMIT 1;

  IF NOT v_hook_confirmed THEN
    RETURN false;
  END IF;

  -- 6. Pepper proxy ready (non-sensitive boolean, NOT raw pepper value)
  SELECT COALESCE(value = 'true', false) INTO v_pepper_proxy
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_rate_limit_pepper_configured' LIMIT 1;

  IF NOT v_pepper_proxy THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_phone_login_readiness() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_phone_login_readiness() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_phone_login_readiness() FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Internal function GRANT minimization
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.sync_normalized_profile_fields() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_normalized_profile_fields() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_normalized_profile_fields() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.guard_protected_profile_fields() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_protected_profile_fields() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_protected_profile_fields() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.guard_protected_profile_fields_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_protected_profile_fields_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_protected_profile_fields_insert() FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Complete settings setter with JSONB patch
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
  v_account_status text;
  v_is_active boolean := false;
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
    'lock_threshold', 'lock_duration_minutes', 'recovery_enabled'
  ];
  v_int_val integer;
BEGIN
  -- 1. Must have valid session
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- 2. Extract session_id from JWT, reject if NULL
  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  -- 3. Must be security_admin, active, account_status = ACTIVE
  SELECT COALESCE(account_status, 'ACTIVE'), COALESCE(is_active, false), COALESCE(is_security_admin, false)
  INTO v_account_status, v_is_active, v_is_security_admin
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF v_account_status != 'ACTIVE' OR NOT v_is_active OR NOT v_is_security_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- 4. Load current settings (FOR UPDATE to lock the row)
  SELECT * INTO v_current
  FROM public.auth_security_settings
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  -- 5. Optimistic concurrency
  IF v_current.settings_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT',
      'current_version', v_current.settings_version);
  END IF;

  -- 6. Validate patch keys and values BEFORE consuming grant
  v_new := v_current;

  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_patch) LOOP
    -- Check key is whitelisted
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY', 'key', v_key);
    END IF;

    -- Type and range validation per key
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
        v_int_val := (v_value #>> '{}')::integer;
        IF v_int_val < 1 OR v_int_val > 10080 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'key', v_key);
        END IF;
        v_new.session_idle_timeout_minutes := v_int_val;

      WHEN 'session_absolute_lifetime_minutes' THEN
        IF jsonb_typeof(v_value) != 'number' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_int_val := (v_value #>> '{}')::integer;
        IF v_int_val < 1 OR v_int_val > 43200 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'key', v_key);
        END IF;
        v_new.session_absolute_lifetime_minutes := v_int_val;

      WHEN 'max_active_sessions' THEN
        IF jsonb_typeof(v_value) != 'number' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_int_val := (v_value #>> '{}')::integer;
        IF v_int_val < 1 OR v_int_val > 100 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'key', v_key);
        END IF;
        v_new.max_active_sessions := v_int_val;

      WHEN 'lock_threshold' THEN
        IF jsonb_typeof(v_value) != 'number' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_int_val := (v_value #>> '{}')::integer;
        IF v_int_val < 1 OR v_int_val > 50 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'key', v_key);
        END IF;
        v_new.lock_threshold := v_int_val;

      WHEN 'lock_duration_minutes' THEN
        IF jsonb_typeof(v_value) != 'number' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
        END IF;
        v_int_val := (v_value #>> '{}')::integer;
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

  -- 7. Dependency: at least one login method must remain enabled
  IF NOT (v_new.username_login OR v_new.email_login OR v_new.phone_login) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LOGIN_METHOD_ENABLED');
  END IF;

  -- 8. Require step-up grant: strict session match, no NULL=NULL
  -- First verify session exists in auth.sessions and belongs to same user
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
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
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  -- 9. Consume grant just before commit
  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_stepup_grant.id;

  -- 10. Increment version
  v_new_version := v_current.settings_version + 1;

  -- 11. Capture full before_state
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

  -- 12. Update settings atomically
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

  -- 13. Capture full after_state
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

  -- 14. Write to history with full snapshot
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
    now(), v_uid, p_change_reason
  );

  -- 15. Audit event with full sanitized before/after
  INSERT INTO public.security_audit_events (
    user_id, actor_user_id, event_type, event_category, severity,
    session_id, before_state, after_state, result, metadata
  ) VALUES (
    v_uid, v_uid, 'auth_security_settings_changed', 'settings_change', 'info',
    v_session_id,
    public.sanitize_audit_metadata(v_before_state),
    public.sanitize_audit_metadata(v_after_state),
    'success',
    public.sanitize_audit_metadata(jsonb_build_object(
      'new_version', v_new_version,
      'change_reason', p_change_reason
    ))
  );

  RETURN jsonb_build_object('ok', true, 'new_version', v_new_version);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings_patch(integer, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings_patch(integer, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_auth_security_settings_patch(integer, jsonb, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8b. Redefine legacy set_auth_security_settings as wrapper delegate
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- Build patch from legacy parameters (NULL means don't change)
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

  -- Delegate to complete setter
  RETURN public.set_auth_security_settings_patch(p_expected_version, v_patch, p_change_reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) TO authenticated;
