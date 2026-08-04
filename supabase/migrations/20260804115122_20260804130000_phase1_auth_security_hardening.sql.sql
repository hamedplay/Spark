/*
# Phase 1 Amendment: Canonical Auth Security Hardening

## Purpose
Fixes eight deficiencies from the initial Phase 1 migration — all additive, no data loss,
no runtime/UI/edge-function changes. Single timestamped migration.

## 1. Profile Security Column Protection
- Redefines `guard_protected_profile_fields()` to also block direct INSERT/UPDATE of:
  account_status, profile_completion_status, mfa_enrollment_required,
  normalized_username, normalized_email, normalized_phone,
  email_verified_at, phone_verified_at, is_security_admin
- Adds BEFORE INSERT trigger using the same function (was only BEFORE UPDATE before)
- New `sync_normalized_profile_fields()` trigger auto-generates normalized values server-side,
  ignoring any client-supplied normalized values

## 2. Canonical Status CHECK Constraints
- account_status: PHONE_UNVERIFIED, PENDING_ADMIN_APPROVAL, ACTIVE, REJECTED, SUSPENDED, LOCKED
- profile_completion_status: NOT_STARTED, IN_PROGRESS, COMPLETE
- Defaults for new records: account_status = 'ACTIVE', profile_completion_status = 'COMPLETE'
- Existing backfill unchanged

## 3. is_security_admin Column
- New boolean column on profiles, default false
- Backfill: active admins (is_admin = true) get true
- Protected by trigger (same as other security columns)
- set_auth_security_settings now requires is_security_admin = true (not just is_admin)

## 4. session_security_grants Enhancement
- New columns: session_id, purpose, factor_type, assurance_level, request_id
- session_id FK to auth.sessions.id (nullable, ON DELETE CASCADE)
- CHECK constraints for purpose and factor_type values
- set_auth_security_settings now validates grant against JWT session_id, purpose, factor, expiry

## 5. Backend-Only Audit
- Drops authenticated INSERT policy on security_audit_events
- New columns: ip_hash, session_id, request_id, actor_user_id, target_user_id,
  before_state, after_state, result, error_code
- New `sanitize_audit_metadata()` function strips secrets from jsonb
- Audit inserts now happen only from SECURITY DEFINER RPCs (bypass RLS)

## 6. Canonical Settings Expansion
- 14 new columns on auth_security_settings
- Seeded from current system_config / runtime behavior
- History table gets matching columns + unique constraint on version
- Version 1 snapshot inserted into history (was empty)

## 7. Phone Login Readiness
- New `check_phone_login_readiness()` internal function — fail-closed
- get_public_login_methods returns phone_login = enabled AND ready

## 8. Verification Timestamp Sync
- email_verified_at synced from auth.users.email_confirmed_at
- phone_verified_at synced from auth.users.phone_confirmed_at
- Only for profiles with valid auth.users records

## Security
- All new/redefined SECURITY DEFINER functions: SET search_path = ''
- All object references schema-qualified
- REVOKE from PUBLIC/anon except public 3-boolean RPC
- No DROP of tables, data, or previous migrations
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Add is_security_admin column to profiles
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_security_admin'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN is_security_admin boolean DEFAULT false;
  END IF;
END $$;

-- Backfill: active admins get is_security_admin = true
UPDATE public.profiles
SET is_security_admin = true
WHERE is_admin = true AND COALESCE(is_active, false) = true
  AND is_security_admin IS NULL;

-- Set default for any remaining NULL
UPDATE public.profiles
SET is_security_admin = false
WHERE is_security_admin IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Canonical status CHECK constraints and defaults
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_account_status_check'
    AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_account_status_check
    CHECK (account_status IS NULL OR account_status IN (
      'PHONE_UNVERIFIED', 'PENDING_ADMIN_APPROVAL', 'ACTIVE',
      'REJECTED', 'SUSPENDED', 'LOCKED'
    ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_profile_completion_status_check'
    AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_profile_completion_status_check
    CHECK (profile_completion_status IS NULL OR profile_completion_status IN (
      'NOT_STARTED', 'IN_PROGRESS', 'COMPLETE'
    ));
  END IF;
END $$;

-- Set safe defaults for new records (does not affect existing)
ALTER TABLE public.profiles
  ALTER COLUMN account_status SET DEFAULT 'ACTIVE';
ALTER TABLE public.profiles
  ALTER COLUMN profile_completion_status SET DEFAULT 'COMPLETE';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Redefine guard_protected_profile_fields to include security columns
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_current_user_admin() THEN
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
    -- New security columns
    OR NEW.account_status IS DISTINCT FROM OLD.account_status
    OR NEW.profile_completion_status IS DISTINCT FROM OLD.profile_completion_status
    OR NEW.mfa_enrollment_required IS DISTINCT FROM OLD.mfa_enrollment_required
    OR NEW.normalized_username IS DISTINCT FROM OLD.normalized_username
    OR NEW.normalized_email IS DISTINCT FROM OLD.normalized_email
    OR NEW.normalized_phone IS DISTINCT FROM OLD.normalized_phone
    OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at
    OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at
    OR NEW.is_security_admin IS DISTINCT FROM OLD.is_security_admin
    THEN
      RAISE EXCEPTION 'Not allowed to modify protected profile fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop and recreate existing BEFORE UPDATE trigger
DROP TRIGGER IF EXISTS trg_guard_protected_profile_fields ON public.profiles;
CREATE TRIGGER trg_guard_protected_profile_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_protected_profile_fields();

-- New BEFORE INSERT trigger for same protection
DROP TRIGGER IF EXISTS trg_guard_protected_profile_fields_insert ON public.profiles;
CREATE TRIGGER trg_guard_protected_profile_fields_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_protected_profile_fields();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Server-side normalized value sync trigger
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_normalized_profile_fields()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Always derive normalized values server-side; ignore client-supplied values
  IF NEW.username IS NOT NULL AND btrim(NEW.username) <> '' THEN
    NEW.normalized_username := lower(btrim(NEW.username));
  ELSE
    NEW.normalized_username := NULL;
  END IF;

  IF NEW.email IS NOT NULL AND btrim(NEW.email) <> '' THEN
    NEW.normalized_email := lower(btrim(NEW.email));
  ELSE
    NEW.normalized_email := NULL;
  END IF;

  IF NEW.phone IS NOT NULL AND btrim(NEW.phone) <> '' AND NEW.phone <> '' THEN
    NEW.normalized_phone := '+' || public.normalize_iran_phone(NEW.phone);
    IF NEW.normalized_phone = '+' THEN
      NEW.normalized_phone := NULL;
    END IF;
  ELSE
    NEW.normalized_phone := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_normalized_profile_fields ON public.profiles;
CREATE TRIGGER trg_sync_normalized_profile_fields
  BEFORE INSERT OR UPDATE OF username, email, phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_normalized_profile_fields();

-- Also fire on UPDATE of normalized columns themselves (client trying to set directly)
-- This trigger will overwrite their value from source columns
DROP TRIGGER IF EXISTS trg_sync_normalized_profile_fields_direct ON public.profiles;
CREATE TRIGGER trg_sync_normalized_profile_fields_direct
  BEFORE UPDATE OF normalized_username, normalized_email, normalized_phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_normalized_profile_fields();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. session_security_grants: add new columns
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_security_grants' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE public.session_security_grants ADD COLUMN session_id uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_security_grants' AND column_name = 'purpose'
  ) THEN
    ALTER TABLE public.session_security_grants ADD COLUMN purpose text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_security_grants' AND column_name = 'factor_type'
  ) THEN
    ALTER TABLE public.session_security_grants ADD COLUMN factor_type text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_security_grants' AND column_name = 'assurance_level'
  ) THEN
    ALTER TABLE public.session_security_grants ADD COLUMN assurance_level text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_security_grants' AND column_name = 'request_id'
  ) THEN
    ALTER TABLE public.session_security_grants ADD COLUMN request_id uuid;
  END IF;
END $$;

-- FK to auth.sessions.id (nullable, ON DELETE CASCADE)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_security_grants_session_id_fkey'
    AND conrelid = 'public.session_security_grants'::regclass
  ) THEN
    ALTER TABLE public.session_security_grants
    ADD CONSTRAINT session_security_grants_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;
  END IF;
END $$;

-- CHECK constraints for purpose and factor_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_security_grants_purpose_check'
    AND conrelid = 'public.session_security_grants'::regclass
  ) THEN
    ALTER TABLE public.session_security_grants
    ADD CONSTRAINT session_security_grants_purpose_check
    CHECK (purpose IS NULL OR purpose IN (
      'auth_settings_change', 'account_security_change',
      'session_management', 'recovery_change'
    ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_security_grants_factor_type_check'
    AND conrelid = 'public.session_security_grants'::regclass
  ) THEN
    ALTER TABLE public.session_security_grants
    ADD CONSTRAINT session_security_grants_factor_type_check
    CHECK (factor_type IS NULL OR factor_type IN (
      'totp', 'bale', 'email', 'recovery_code', 'password_reauth'
    ));
  END IF;
END $$;

-- Index for grant lookup by session + purpose
CREATE INDEX IF NOT EXISTS idx_session_security_grants_session_purpose
  ON public.session_security_grants (session_id, purpose)
  WHERE consumed_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. security_audit_events: backend-only insert + new columns
-- ═══════════════════════════════════════════════════════════════════════════

-- Add new columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_audit_events' AND column_name = 'ip_hash'
  ) THEN
    ALTER TABLE public.security_audit_events ADD COLUMN ip_hash text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_audit_events' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE public.security_audit_events ADD COLUMN session_id uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_audit_events' AND column_name = 'request_id'
  ) THEN
    ALTER TABLE public.security_audit_events ADD COLUMN request_id uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_audit_events' AND column_name = 'actor_user_id'
  ) THEN
    ALTER TABLE public.security_audit_events ADD COLUMN actor_user_id uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_audit_events' AND column_name = 'target_user_id'
  ) THEN
    ALTER TABLE public.security_audit_events ADD COLUMN target_user_id uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_audit_events' AND column_name = 'before_state'
  ) THEN
    ALTER TABLE public.security_audit_events ADD COLUMN before_state jsonb;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_audit_events' AND column_name = 'after_state'
  ) THEN
    ALTER TABLE public.security_audit_events ADD COLUMN after_state jsonb;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_audit_events' AND column_name = 'result'
  ) THEN
    ALTER TABLE public.security_audit_events ADD COLUMN result text DEFAULT 'success';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_audit_events' AND column_name = 'error_code'
  ) THEN
    ALTER TABLE public.security_audit_events ADD COLUMN error_code text;
  END IF;
END $$;

-- Drop the authenticated INSERT policy — audit is now backend-only (via SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "authenticated_insert_security_audit_events" ON public.security_audit_events;

-- Add result CHECK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'security_audit_events_result_check'
    AND conrelid = 'public.security_audit_events'::regclass
  ) THEN
    ALTER TABLE public.security_audit_events
    ADD CONSTRAINT security_audit_events_result_check
    CHECK (result IS NULL OR result IN ('success', 'failure', 'denied', 'error'));
  END IF;
END $$;

-- Sanitize audit metadata function (strips secret keys from jsonb)
CREATE OR REPLACE FUNCTION public.sanitize_audit_metadata(p_metadata jsonb)
RETURNS jsonb
SET search_path = ''
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result jsonb := p_metadata;
  v_key text;
  v_secret_keys text[] := ARRAY[
    'password', 'otp', 'token', 'access_token', 'refresh_token',
    'authorization', 'secret', 'api_key', 'recovery_code'
  ];
BEGIN
  IF v_result IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  FOREACH v_key IN ARRAY v_secret_keys LOOP
    v_result := v_result - v_key;
    v_result := v_result - lower(v_key);
    v_result := v_result - upper(v_key);
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sanitize_audit_metadata(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sanitize_audit_metadata(jsonb) FROM anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. auth_security_settings: add canonical settings columns
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='registration_enabled') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN registration_enabled boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='registration_requires_admin_approval') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN registration_requires_admin_approval boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='require_profile_completion') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN require_profile_completion boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='allow_totp_mfa') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN allow_totp_mfa boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='allow_bale_mfa') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN allow_bale_mfa boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='allow_email_mfa') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN allow_email_mfa boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='allow_recovery_codes') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN allow_recovery_codes boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='session_idle_timeout_minutes') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN session_idle_timeout_minutes integer NOT NULL DEFAULT 480;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='session_absolute_lifetime_minutes') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN session_absolute_lifetime_minutes integer NOT NULL DEFAULT 1440;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='max_active_sessions') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN max_active_sessions integer NOT NULL DEFAULT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='lock_threshold') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN lock_threshold integer NOT NULL DEFAULT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='lock_duration_minutes') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN lock_duration_minutes integer NOT NULL DEFAULT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='recovery_enabled') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN recovery_enabled boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings' AND column_name='config_schema_version') THEN
    ALTER TABLE public.auth_security_settings ADD COLUMN config_schema_version integer NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Seed new columns from current runtime behavior (additive, no behavior change)
UPDATE public.auth_security_settings SET
  registration_enabled = true,
  registration_requires_admin_approval = false,
  require_profile_completion = false,
  allow_totp_mfa = COALESCE(
    (SELECT (value = 'true') FROM public.system_config WHERE section='security' AND key='enable_2fa' LIMIT 1),
    false
  ),
  allow_bale_mfa = COALESCE(
    (SELECT (value = 'true') FROM public.system_config WHERE section='security' AND key='phone_login_bale_otp_enabled' LIMIT 1),
    false
  ),
  allow_email_mfa = false,
  allow_recovery_codes = false,
  session_idle_timeout_minutes = COALESCE(
    (SELECT value::int FROM public.system_config WHERE section='security' AND key='session_timeout_minutes' LIMIT 1),
    480
  ),
  session_absolute_lifetime_minutes = 1440,
  max_active_sessions = 5,
  lock_threshold = COALESCE(
    (SELECT value::int FROM public.system_config WHERE section='security' AND key='max_login_attempts' LIMIT 1),
    5
  ),
  lock_duration_minutes = 30,
  recovery_enabled = COALESCE(
    (SELECT (value = 'true') FROM public.system_config WHERE section='security' AND key='phone_password_recovery_canonical_enabled' LIMIT 1),
    false
  ),
  config_schema_version = 1
WHERE id = 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. auth_security_settings_history: add matching columns + unique on version
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='registration_enabled') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN registration_enabled boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='registration_requires_admin_approval') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN registration_requires_admin_approval boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='require_profile_completion') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN require_profile_completion boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='allow_totp_mfa') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN allow_totp_mfa boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='allow_bale_mfa') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN allow_bale_mfa boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='allow_email_mfa') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN allow_email_mfa boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='allow_recovery_codes') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN allow_recovery_codes boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='session_idle_timeout_minutes') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN session_idle_timeout_minutes integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='session_absolute_lifetime_minutes') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN session_absolute_lifetime_minutes integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='max_active_sessions') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN max_active_sessions integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='lock_threshold') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN lock_threshold integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='lock_duration_minutes') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN lock_duration_minutes integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='recovery_enabled') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN recovery_enabled boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_security_settings_history' AND column_name='config_schema_version') THEN
    ALTER TABLE public.auth_security_settings_history ADD COLUMN config_schema_version integer;
  END IF;
END $$;

-- Unique constraint on version in history
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_security_settings_history_version_unique
  ON public.auth_security_settings_history (version);

-- Insert version 1 snapshot (history was empty)
INSERT INTO public.auth_security_settings_history (
  version, username_login, email_login, phone_login, mfa_policy,
  registration_enabled, registration_requires_admin_approval, require_profile_completion,
  allow_totp_mfa, allow_bale_mfa, allow_email_mfa, allow_recovery_codes,
  session_idle_timeout_minutes, session_absolute_lifetime_minutes, max_active_sessions,
  lock_threshold, lock_duration_minutes, recovery_enabled, config_schema_version,
  changed_at, changed_by, change_reason
)
SELECT
  settings_version, username_login, email_login, phone_login, mfa_policy,
  registration_enabled, registration_requires_admin_approval, require_profile_completion,
  allow_totp_mfa, allow_bale_mfa, allow_email_mfa, allow_recovery_codes,
  session_idle_timeout_minutes, session_absolute_lifetime_minutes, max_active_sessions,
  lock_threshold, lock_duration_minutes, recovery_enabled, config_schema_version,
  updated_at, updated_by, 'initial snapshot'
FROM public.auth_security_settings
WHERE id = 1
AND NOT EXISTS (
  SELECT 1 FROM public.auth_security_settings_history WHERE version = 1
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Phone login readiness function (fail-closed, internal)
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
  v_provider_active boolean := false;
  v_template_active boolean := false;
  v_template_has_otp boolean := false;
  v_origins text := '';
  v_hook_confirmed boolean := false;
  v_pepper text := '';
BEGIN
  -- 1. Phone login enabled in canonical settings?
  SELECT COALESCE(phone_login, false) INTO v_enabled
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  IF NOT v_enabled THEN
    RETURN false;
  END IF;

  -- 2. SMS Provider selected and active?
  SELECT value INTO v_provider_id
  FROM public.system_config
  WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

  IF v_provider_id IS NULL OR btrim(v_provider_id) = '' THEN
    RETURN false;
  END IF;

  SELECT COALESCE(is_active, false) INTO v_provider_active
  FROM public.sms_providers
  WHERE id = v_provider_id::uuid LIMIT 1;

  IF NOT v_provider_active THEN
    RETURN false;
  END IF;

  -- 3. Template active and has {{otp}}?
  SELECT COALESCE(is_active, false), body LIKE '%{{otp}}%'
  INTO v_template_active, v_template_has_otp
  FROM public.sms_templates
  WHERE category = 'auth' AND event_type = 'login_otp'
  LIMIT 1;

  IF NOT v_template_active OR NOT v_template_has_otp THEN
    RETURN false;
  END IF;

  -- 4. Allowed origin configured?
  SELECT value INTO v_origins
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1;

  IF v_origins IS NULL OR btrim(v_origins) = '' THEN
    RETURN false;
  END IF;

  -- 5. Hook operator confirmed?
  SELECT COALESCE(value = 'true', false) INTO v_hook_confirmed
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed' LIMIT 1;

  IF NOT v_hook_confirmed THEN
    RETURN false;
  END IF;

  -- 6. Pepper configured?
  SELECT value INTO v_pepper
  FROM public.system_config
  WHERE section = 'security' AND key = 'phone_auth_pepper' LIMIT 1;

  IF v_pepper IS NULL OR length(v_pepper) < 32 THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_phone_login_readiness() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_phone_login_readiness() FROM anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Redefine get_public_login_methods with readiness
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_login_methods()
RETURNS TABLE (
  username_login boolean,
  email_login boolean,
  phone_login boolean
)
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row public.auth_security_settings%ROWTYPE;
  v_phone_ready boolean := false;
BEGIN
  SELECT * INTO v_row
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT true, true, false;
    RETURN;
  END IF;

  -- Phone login = capability enabled AND readiness passed (fail-closed)
  v_phone_ready := public.check_phone_login_readiness();

  RETURN QUERY SELECT
    v_row.username_login,
    v_row.email_login,
    (v_row.phone_login AND v_phone_ready);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_login_methods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_login_methods() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_login_methods() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Redefine set_auth_security_settings with security_admin + session-bound grant
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
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_account_status text;
  v_is_active boolean := false;
  v_is_security_admin boolean := false;
  v_current public.auth_security_settings%ROWTYPE;
  v_new_username boolean;
  v_new_email boolean;
  v_new_phone boolean;
  v_new_mfa text;
  v_new_version integer;
  v_stepup_grant public.session_security_grants%ROWTYPE;
  v_before_state jsonb;
  v_after_state jsonb;
BEGIN
  -- 1. Must have valid session
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- Extract session_id from JWT
  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;

  -- 2. Must be security_admin, active, and account_status = ACTIVE
  SELECT COALESCE(account_status, 'ACTIVE'), COALESCE(is_active, false), COALESCE(is_security_admin, false)
  INTO v_account_status, v_is_active, v_is_security_admin
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF v_account_status != 'ACTIVE' OR NOT v_is_active OR NOT v_is_security_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- 3. Load current settings (FOR UPDATE to lock the row)
  SELECT * INTO v_current
  FROM public.auth_security_settings
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  -- 4. Optimistic concurrency
  IF v_current.settings_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT',
      'current_version', v_current.settings_version);
  END IF;

  -- 5. Validate inputs BEFORE consuming grant (invalid request must not burn grant)

  -- Compute new values (NULL means keep current)
  v_new_username := COALESCE(p_username_login, v_current.username_login);
  v_new_email := COALESCE(p_email_login, v_current.email_login);
  v_new_phone := COALESCE(p_phone_login, v_current.phone_login);
  v_new_mfa := COALESCE(p_mfa_policy, v_current.mfa_policy);

  -- Validate at least one login method remains enabled
  IF NOT (v_new_username OR v_new_email OR v_new_phone) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LOGIN_METHOD_ENABLED');
  END IF;

  -- Validate mfa_policy
  IF v_new_mfa NOT IN ('disabled', 'optional', 'required') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MFA_POLICY');
  END IF;

  -- 6. Require step-up grant: same user, same session, correct purpose, unconsumed, unexpired, <=5min
  SELECT * INTO v_stepup_grant
  FROM public.session_security_grants
  WHERE user_id = v_uid
    AND (session_id = v_session_id OR (session_id IS NULL AND v_session_id IS NULL))
    AND purpose = 'auth_settings_change'
    AND consumed_at IS NULL
    AND expires_at >= now()
    AND issued_at >= now() - interval '5 minutes'
  ORDER BY issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  -- 7. All validations passed — consume the grant just before commit
  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_stepup_grant.id;

  -- 8. Increment version
  v_new_version := v_current.settings_version + 1;

  -- 9. Capture before_state for audit
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

  -- 10. Update settings atomically
  UPDATE public.auth_security_settings
  SET settings_version = v_new_version,
      username_login = v_new_username,
      email_login = v_new_email,
      phone_login = v_new_phone,
      mfa_policy = v_new_mfa,
      updated_at = now(),
      updated_by = v_uid
  WHERE id = 1;

  -- 11. Capture after_state
  v_after_state := jsonb_build_object(
    'settings_version', v_new_version,
    'username_login', v_new_username,
    'email_login', v_new_email,
    'phone_login', v_new_phone,
    'mfa_policy', v_new_mfa
  );

  -- 12. Write to history
  INSERT INTO public.auth_security_settings_history (
    version, username_login, email_login, phone_login, mfa_policy,
    registration_enabled, registration_requires_admin_approval, require_profile_completion,
    allow_totp_mfa, allow_bale_mfa, allow_email_mfa, allow_recovery_codes,
    session_idle_timeout_minutes, session_absolute_lifetime_minutes, max_active_sessions,
    lock_threshold, lock_duration_minutes, recovery_enabled, config_schema_version,
    changed_at, changed_by, change_reason
  ) VALUES (
    v_new_version, v_new_username, v_new_email, v_new_phone, v_new_mfa,
    v_current.registration_enabled, v_current.registration_requires_admin_approval,
    v_current.require_profile_completion, v_current.allow_totp_mfa, v_current.allow_bale_mfa,
    v_current.allow_email_mfa, v_current.allow_recovery_codes,
    v_current.session_idle_timeout_minutes, v_current.session_absolute_lifetime_minutes,
    v_current.max_active_sessions, v_current.lock_threshold, v_current.lock_duration_minutes,
    v_current.recovery_enabled, v_current.config_schema_version,
    now(), v_uid, p_change_reason
  );

  -- 13. Audit event (sanitized, backend-only via SECURITY DEFINER bypassing RLS)
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

REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Sync verification timestamps from auth.users
-- ═══════════════════════════════════════════════════════════════════════════

-- Sync email_verified_at from auth.users.email_confirmed_at (only where different)
UPDATE public.profiles p
SET email_verified_at = u.email_confirmed_at
FROM auth.users u
WHERE u.id = p.user_id
  AND u.email_confirmed_at IS NOT NULL
  AND p.email_verified_at IS DISTINCT FROM u.email_confirmed_at;

-- Sync phone_verified_at from auth.users.phone_confirmed_at (only where auth.users has a value)
UPDATE public.profiles p
SET phone_verified_at = u.phone_confirmed_at
FROM auth.users u
WHERE u.id = p.user_id
  AND u.phone_confirmed_at IS NOT NULL
  AND p.phone_verified_at IS DISTINCT FROM u.phone_confirmed_at;
