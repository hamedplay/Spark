/*
# Phase 1: Canonical Auth Security Data Model

## Purpose
Adds the missing canonical auth concepts to the `profiles` table, creates two new
security infrastructure tables (`auth_security_settings` with versioned history,
and `security_audit_events` as append-only), and introduces an atomic settings-mutation
RPC with optimistic concurrency, step-up verification, and a minimal public RPC that
returns only three booleans. No runtime behavior changes — this is purely additive
schema and data backfill.

## 1. New Columns on `profiles` (all additive, all nullable, all backfilled)
- `account_status` (text) — canonical lifecycle: ACTIVE, SUSPENDED, PENDING_ACTIVATION, LOCKED
- `profile_completion_status` (text) — COMPLETE, INCOMPLETE
- `mfa_enrollment_required` (boolean, default false) — per-user MFA requirement
- `normalized_username` (text) — lowercased trimmed username for case-insensitive uniqueness
- `normalized_email` (text) — lowercased trimmed email for case-insensitive uniqueness
- `normalized_phone` (text) — E.164 format +989xxxxxxxxx
- `email_verified_at` (timestamptz) — timestamp of email confirmation
- `phone_verified_at` (timestamptz) — timestamp of phone confirmation

## 2. New Table: `auth_security_settings`
- Single-row unit table (enforced by partial unique index on `id = 1`)
- Stores canonical security configuration with `settings_version` for optimistic concurrency
- Seeded from current `system_config` values without changing runtime behavior
- Columns: `id` (int, always 1), `settings_version` (int, starts at 1),
  `username_login`, `email_login`, `phone_login` (booleans),
  `mfa_policy` (text: disabled, optional, required), `updated_at`, `updated_by`

## 3. New Table: `auth_security_settings_history`
- Versioned history of `auth_security_settings` — one row per change
- Columns mirror settings + `version` + `changed_at` + `changed_by` + `change_reason`

## 4. New Table: `session_security_grants`
- Tracks step-up grants (MFA verification, recent re-auth)
- Columns: `id`, `user_id`, `grant_type` (mfa_stepup, reauth), `issued_at`, `expires_at`,
  `consumed_at`, `metadata_hash`
- TTL: 5 minutes for step-up grants

## 5. New Table: `security_audit_events`
- Append-only audit log for security-relevant actions
- No secrets, OTPs, passwords, tokens, or full contact identifiers
- Columns: `id`, `user_id`, `event_type`, `event_category`, `severity`,
  `ip_address`, `user_agent_hash`, `metadata` (jsonb, sanitized), `created_at`
- RLS: INSERT only by authenticated (owner or admin), SELECT admin-only

## 6. New RPC: `set_auth_security_settings`
- Atomic settings mutation with:
  - `expected_version` for optimistic concurrency (409 on mismatch)
  - Validates at least one login method remains enabled
  - Requires `security_admin` role (admin in profiles)
  - Requires valid session (auth.uid() not null)
  - Requires MFA step-up grant within last 5 minutes
  - Writes to both `auth_security_settings` and `auth_security_settings_history`
- SECURITY DEFINER, search_path = '', schema-qualified names
- REVOKE FROM PUBLIC and anon, GRANT to authenticated only

## 7. New RPC: `get_public_login_methods`
- Returns ONLY three booleans: username_login, email_login, phone_login
- No secrets, no readiness, no admin data
- SECURITY DEFINER, search_path = '', GRANT to anon and authenticated

## 8. Backfill
- Active profiles (is_active = true) → account_status = 'ACTIVE', profile_completion_status = 'COMPLETE'
- Inactive profiles (is_active = false or null) → account_status = 'SUSPENDED', profile_completion_status = 'COMPLETE'
- normalized_username = lower(trim(username)) where username is not null
- normalized_email = lower(trim(email)) where email is not null
- normalized_phone = '+98' || normalize_iran_phone(phone) where phone is not null and normalize_iran_phone(phone) <> ''
- email_verified_at = created_at (assume existing emails are verified)
- phone_verified_at = null (no existing phone verification data)

## 9. Revocation of anon EXECUTE on legacy setter RPCs
- REVOKE EXECUTE on `set_phone_auth_canonical_flags` FROM anon
- REVOKE EXECUTE on `get_phone_auth_admin_status` FROM anon
- Functions and data are NOT dropped; only the anon role loses direct access

## 10. Security
- All new tables have RLS enabled
- All new SECURITY DEFINER functions have SET search_path = ''
- All table references are schema-qualified (public.)
- Minimum necessary GRANTs only
- No destructive operations (no DROP, DELETE, TRUNCATE, CASCADE)
- No previous migrations modified
- No existing data deleted or modified (only additive backfill)
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Add canonical columns to profiles
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'account_status'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN account_status text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'profile_completion_status'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN profile_completion_status text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'mfa_enrollment_required'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN mfa_enrollment_required boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'normalized_username'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN normalized_username text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'normalized_email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN normalized_email text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'normalized_phone'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN normalized_phone text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email_verified_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email_verified_at timestamptz;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'phone_verified_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN phone_verified_at timestamptz;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Backfill profiles canonical columns
-- ═══════════════════════════════════════════════════════════════════════════

-- account_status: ACTIVE for active, SUSPENDED for inactive
UPDATE public.profiles
SET account_status = CASE
  WHEN COALESCE(is_active, false) = true THEN 'ACTIVE'
  ELSE 'SUSPENDED'
END
WHERE account_status IS NULL;

-- profile_completion_status: COMPLETE for all existing users (they can already log in)
UPDATE public.profiles
SET profile_completion_status = 'COMPLETE'
WHERE profile_completion_status IS NULL;

-- mfa_enrollment_required: false for all existing users
UPDATE public.profiles
SET mfa_enrollment_required = false
WHERE mfa_enrollment_required IS NULL;

-- normalized_username: lower(trim(username))
UPDATE public.profiles
SET normalized_username = lower(btrim(username))
WHERE username IS NOT NULL AND btrim(username) <> ''
  AND normalized_username IS NULL;

-- normalized_email: lower(trim(email))
UPDATE public.profiles
SET normalized_email = lower(btrim(email))
WHERE email IS NOT NULL AND btrim(email) <> ''
  AND normalized_email IS NULL;

-- normalized_phone: +989xxxxxxxxx format
UPDATE public.profiles
SET normalized_phone = '+' || public.normalize_iran_phone(phone)
WHERE phone IS NOT NULL AND btrim(phone) <> '' AND phone <> ''
  AND public.normalize_iran_phone(phone) <> ''
  AND normalized_phone IS NULL;

-- email_verified_at: assume existing emails are verified at creation time
UPDATE public.profiles
SET email_verified_at = COALESCE(created_at, now())
WHERE email IS NOT NULL AND btrim(email) <> ''
  AND email_verified_at IS NULL;

-- phone_verified_at: leave NULL — no existing verification data

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Unique indexes on normalized columns (check duplicates first)
-- ═══════════════════════════════════════════════════════════════════════════

-- Re-check duplicates before creating constraints (safety, should be empty)
DO $$
DECLARE
  v_dup_phone int;
  v_dup_username int;
  v_dup_email int;
BEGIN
  SELECT COUNT(*) INTO v_dup_phone FROM (
    SELECT normalized_phone, COUNT(*) AS c
    FROM public.profiles
    WHERE normalized_phone IS NOT NULL
    GROUP BY normalized_phone HAVING COUNT(*) > 1
  ) sub;
  IF v_dup_phone > 0 THEN
    RAISE EXCEPTION 'Duplicate normalized_phone values found (%) — resolve before adding unique constraint', v_dup_phone;
  END IF;

  SELECT COUNT(*) INTO v_dup_username FROM (
    SELECT normalized_username, COUNT(*) AS c
    FROM public.profiles
    WHERE normalized_username IS NOT NULL
    GROUP BY normalized_username HAVING COUNT(*) > 1
  ) sub;
  IF v_dup_username > 0 THEN
    RAISE EXCEPTION 'Duplicate normalized_username values found (%) — resolve before adding unique constraint', v_dup_username;
  END IF;

  SELECT COUNT(*) INTO v_dup_email FROM (
    SELECT normalized_email, COUNT(*) AS c
    FROM public.profiles
    WHERE normalized_email IS NOT NULL
    GROUP BY normalized_email HAVING COUNT(*) > 1
  ) sub;
  IF v_dup_email > 0 THEN
    RAISE EXCEPTION 'Duplicate normalized_email values found (%) — resolve before adding unique constraint', v_dup_email;
  END IF;
END $$;

-- Create unique indexes (partial — only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_normalized_phone_unique
  ON public.profiles (normalized_phone)
  WHERE normalized_phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_normalized_username_unique
  ON public.profiles (normalized_username)
  WHERE normalized_username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_normalized_email_unique
  ON public.profiles (normalized_email)
  WHERE normalized_email IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. New Table: auth_security_settings (single-row unit)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.auth_security_settings (
  id integer PRIMARY KEY DEFAULT 1,
  settings_version integer NOT NULL DEFAULT 1,
  username_login boolean NOT NULL DEFAULT true,
  email_login boolean NOT NULL DEFAULT true,
  phone_login boolean NOT NULL DEFAULT false,
  mfa_policy text NOT NULL DEFAULT 'disabled',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT auth_security_settings_single_row CHECK (id = 1),
  CONSTRAINT auth_security_settings_mfa_policy_check
    CHECK (mfa_policy IN ('disabled', 'optional', 'required'))
);

ALTER TABLE public.auth_security_settings ENABLE ROW LEVEL SECURITY;

-- Seed from current system_config values (without changing runtime behavior)
INSERT INTO public.auth_security_settings (id, settings_version, username_login, email_login, phone_login, mfa_policy, updated_at)
SELECT
  1,
  1,
  true,  -- username login is always available
  true,  -- email login is always available
  COALESCE(
    (SELECT (value = 'true') FROM public.system_config
     WHERE section = 'security' AND key = 'phone_login_canonical_enabled' LIMIT 1),
    false
  ),
  'disabled',  -- MFA not enforced yet
  now()
ON CONFLICT (id) DO NOTHING;

-- RLS: only admins can read, nobody can write directly (writes go through RPC)
DROP POLICY IF EXISTS "admins_read_auth_security_settings" ON public.auth_security_settings;
CREATE POLICY "admins_read_auth_security_settings"
  ON public.auth_security_settings FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. New Table: auth_security_settings_history
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.auth_security_settings_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  username_login boolean NOT NULL,
  email_login boolean NOT NULL,
  phone_login boolean NOT NULL,
  mfa_policy text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  change_reason text
);

ALTER TABLE public.auth_security_settings_history ENABLE ROW LEVEL SECURITY;

-- RLS: admins can read, nobody can write directly (RPC inserts with service role)
DROP POLICY IF EXISTS "admins_read_auth_security_settings_history" ON public.auth_security_settings_history;
CREATE POLICY "admins_read_auth_security_settings_history"
  ON public.auth_security_settings_history FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- Index for version lookups
CREATE INDEX IF NOT EXISTS idx_auth_security_settings_history_version
  ON public.auth_security_settings_history (version DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. New Table: session_security_grants
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.session_security_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  grant_type text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  metadata_hash text,
  CONSTRAINT session_security_grants_grant_type_check
    CHECK (grant_type IN ('mfa_stepup', 'reauth'))
);

ALTER TABLE public.session_security_grants ENABLE ROW LEVEL SECURITY;

-- RLS: users can read their own grants, admins can read all, nobody can write directly
DROP POLICY IF EXISTS "users_read_own_session_grants" ON public.session_security_grants;
CREATE POLICY "users_read_own_session_grants"
  ON public.session_security_grants FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_current_user_admin());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_session_security_grants_user_expires
  ON public.session_security_grants (user_id, expires_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_session_security_grants_expires
  ON public.session_security_grants (expires_at)
  WHERE consumed_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. New Table: security_audit_events (append-only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.security_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  event_type text NOT NULL,
  event_category text NOT NULL DEFAULT 'auth',
  severity text NOT NULL DEFAULT 'info',
  ip_address text,
  user_agent_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_audit_events_severity_check
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  CONSTRAINT security_audit_events_category_check
    CHECK (event_category IN ('auth', 'mfa', 'recovery', 'session', 'access', 'account_lock', 'settings_change'))
);

ALTER TABLE public.security_audit_events ENABLE ROW LEVEL SECURITY;

-- RLS: admins can read, authenticated can insert (for self or with null user_id for anonymous events)
DROP POLICY IF EXISTS "admins_read_security_audit_events" ON public.security_audit_events;
CREATE POLICY "admins_read_security_audit_events"
  ON public.security_audit_events FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

DROP POLICY IF EXISTS "authenticated_insert_security_audit_events" ON public.security_audit_events;
CREATE POLICY "authenticated_insert_security_audit_events"
  ON public.security_audit_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL OR public.is_current_user_admin());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_security_audit_events_user_created
  ON public.security_audit_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_type_created
  ON public.security_audit_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_category_created
  ON public.security_audit_events (event_category, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. New RPC: set_auth_security_settings
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
  v_is_admin boolean := false;
  v_is_active boolean := false;
  v_current public.auth_security_settings%ROWTYPE;
  v_new_username boolean;
  v_new_email boolean;
  v_new_phone boolean;
  v_new_mfa text;
  v_new_version integer;
  v_stepup_grant public.session_security_grants%ROWTYPE;
BEGIN
  -- 1. Must have valid session
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- 2. Must be admin and active
  SELECT COALESCE(is_admin, false), COALESCE(is_active, false)
  INTO v_is_admin, v_is_active
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND OR NOT v_is_active OR NOT v_is_admin THEN
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

  -- 4. Optimistic concurrency: expected_version must match
  IF v_current.settings_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT',
      'current_version', v_current.settings_version);
  END IF;

  -- 5. Require MFA step-up grant within last 5 minutes
  SELECT * INTO v_stepup_grant
  FROM public.session_security_grants
  WHERE user_id = v_uid
    AND grant_type = 'mfa_stepup'
    AND consumed_at IS NULL
    AND expires_at >= now()
  ORDER BY issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  -- Consume the grant
  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_stepup_grant.id;

  -- 6. Compute new values (NULL means keep current)
  v_new_username := COALESCE(p_username_login, v_current.username_login);
  v_new_email := COALESCE(p_email_login, v_current.email_login);
  v_new_phone := COALESCE(p_phone_login, v_current.phone_login);
  v_new_mfa := COALESCE(p_mfa_policy, v_current.mfa_policy);

  -- 7. Validate at least one login method remains enabled
  IF NOT (v_new_username OR v_new_email OR v_new_phone) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LOGIN_METHOD_ENABLED');
  END IF;

  -- 8. Validate mfa_policy
  IF v_new_mfa NOT IN ('disabled', 'optional', 'required') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MFA_POLICY');
  END IF;

  -- 9. Increment version
  v_new_version := v_current.settings_version + 1;

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

  -- 11. Write to history
  INSERT INTO public.auth_security_settings_history
    (version, username_login, email_login, phone_login, mfa_policy, changed_at, changed_by, change_reason)
  VALUES
    (v_new_version, v_new_username, v_new_email, v_new_phone, v_new_mfa, now(), v_uid, p_change_reason);

  -- 12. Audit event (no secrets, no tokens)
  INSERT INTO public.security_audit_events
    (user_id, event_type, event_category, severity, metadata)
  VALUES
    (v_uid, 'auth_security_settings_changed', 'settings_change', 'info',
     jsonb_build_object(
       'new_version', v_new_version,
       'username_login', v_new_username,
       'email_login', v_new_email,
       'phone_login', v_new_phone,
       'mfa_policy', v_new_mfa,
       'change_reason', p_change_reason
     ));

  RETURN jsonb_build_object('ok', true, 'new_version', v_new_version);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_auth_security_settings(integer, boolean, boolean, boolean, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. New RPC: get_public_login_methods (returns only 3 booleans)
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
BEGIN
  SELECT * INTO v_row
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT true, true, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_row.username_login,
    v_row.email_login,
    v_row.phone_login;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_login_methods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_login_methods() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_login_methods() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Revoke anon EXECUTE on legacy setter RPCs (do NOT drop functions or data)
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.set_phone_auth_canonical_flags(boolean, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_phone_auth_admin_status() FROM anon;
