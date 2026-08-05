/*
# Phase 4 — Account Lifecycle Foundation

## Summary
Establishes the core account lifecycle infrastructure: new profile columns,
a lifecycle history table, field protection guards, is_active derivation,
and default calendar gating.

## New Columns on profiles (all IF NOT EXISTS, safe defaults)
- account_lifecycle_version bigint NOT NULL DEFAULT 1 — optimistic concurrency for lifecycle transitions
- profile_completion_version bigint NOT NULL DEFAULT 1 — optimistic concurrency for profile completion
- account_status_changed_at timestamptz — when the status last changed
- account_status_changed_by uuid — who changed the status
- registration_source text NOT NULL DEFAULT 'legacy' — how the account was created

## New Table: account_lifecycle_history
- Records every account status transition with actor, old/new values, action, reason
- Direct SELECT revoked from anon and authenticated (service_role / postgres only)

## Modified Functions
- guard_protected_profile_fields: now also protects account_lifecycle_version,
  profile_completion_version, account_status_changed_at, account_status_changed_by,
  registration_source. Uses transaction-local GUCs to allow lifecycle RPCs to write.
- create_default_calendars_for_user: only creates calendars for ACTIVE accounts

## New Functions
- ensure_default_calendars_for_user(p_user_id): idempotent, only for ACTIVE accounts
- on_auth_user_created_lifecycle_profile: trigger on auth.users INSERT that creates
  profile atomically when registration_flow marker is present in app_metadata

## New Trigger
- on_auth_user_created_lifecycle_profile on auth.users AFTER INSERT

## Safety
- No prior migration modified
- No data deleted/reset/truncated
- No MFA policy changed
- Existing records only receive safe defaults
- is_active inconsistency (1 row) not auto-fixed
*/

-- ════════════════════════════════════════════════════════════
-- 1. New columns on profiles
-- ════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'account_lifecycle_version'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN account_lifecycle_version bigint NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'profile_completion_version'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN profile_completion_version bigint NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'account_status_changed_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN account_status_changed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'account_status_changed_by'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN account_status_changed_by uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'registration_source'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN registration_source text NOT NULL DEFAULT 'legacy';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- 2. Registration source CHECK constraint
-- ════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_registration_source_check'
    AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_registration_source_check
    CHECK (registration_source IN ('legacy', 'public_phone_registration', 'admin_created', 'imported'));
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- 3. Account lifecycle history table
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.account_lifecycle_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  actor_user_id uuid,
  old_status text,
  new_status text,
  old_is_active boolean,
  new_is_active boolean,
  old_version bigint,
  new_version bigint,
  action text NOT NULL,
  change_reason text,
  session_id uuid,
  request_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_lifecycle_history ENABLE ROW LEVEL SECURITY;

-- Revoke all direct access from anon and authenticated
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.account_lifecycle_history FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.account_lifecycle_history FROM authenticated;

-- Grant only to service_role and postgres
GRANT SELECT, INSERT ON public.account_lifecycle_history TO service_role;

-- Index for querying by target user
CREATE INDEX IF NOT EXISTS idx_account_lifecycle_history_target
  ON public.account_lifecycle_history (target_user_id, changed_at DESC);

-- ════════════════════════════════════════════════════════════
-- 4. Replace guard_protected_profile_fields
--    Now protects lifecycle columns with GUC-based bypass
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_security_admin boolean := false;
  v_lifecycle_write boolean := false;
  v_completion_write boolean := false;
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

    -- Check GUC flags for lifecycle and completion writes
    v_lifecycle_write := COALESCE(current_setting('app.account_lifecycle_write', true), 'false') = 'true';
    v_completion_write := COALESCE(current_setting('app.profile_completion_write', true), 'false') = 'true';

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

    -- Block lifecycle field changes unless GUC is set
    IF NOT v_lifecycle_write THEN
      IF NEW.account_lifecycle_version IS DISTINCT FROM OLD.account_lifecycle_version
      OR NEW.account_status_changed_at IS DISTINCT FROM OLD.account_status_changed_at
      OR NEW.account_status_changed_by IS DISTINCT FROM OLD.account_status_changed_by
      OR NEW.registration_source IS DISTINCT FROM OLD.registration_source
      THEN
        RAISE EXCEPTION 'Not allowed to modify account lifecycle fields';
      END IF;
    END IF;

    -- Block completion version changes unless GUC is set
    IF NOT v_completion_write THEN
      IF NEW.profile_completion_version IS DISTINCT FROM OLD.profile_completion_version
      THEN
        RAISE EXCEPTION 'Not allowed to modify profile completion version';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_protected_profile_fields() OWNER TO postgres;

-- ════════════════════════════════════════════════════════════
-- 5. is_active consistency trigger
--    Ensures is_active always matches account_status = 'ACTIVE'
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_account_status_active_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Derive is_active from account_status
  IF NEW.account_status = 'ACTIVE' THEN
    IF NEW.is_active IS NOT TRUE THEN
      NEW.is_active := true;
    END IF;
  ELSE
    IF NEW.is_active IS TRUE THEN
      NEW.is_active := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enforce_account_status_active_consistency() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_account_status_active_consistency ON public.profiles;
CREATE TRIGGER trg_account_status_active_consistency
  BEFORE INSERT OR UPDATE OF account_status, is_active ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_status_active_consistency();

-- ════════════════════════════════════════════════════════════
-- 6. Replace create_default_calendars_for_user
--    Only creates calendars for ACTIVE accounts
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_default_calendars_for_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text;
BEGIN
  -- Only create calendars for ACTIVE accounts
  IF NEW.account_status IS DISTINCT FROM 'ACTIVE' OR NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_name := COALESCE(NULLIF(TRIM(NEW.full_name), ''), SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), 'کاربر');

  -- Private calendar
  INSERT INTO public.calendars (user_id, name, type, color, is_active, enable_reminder, enable_overlap, is_occasions, is_personal_public)
  VALUES (
    NEW.user_id,
    v_name,
    'private',
    '#3b82f6',
    true, true, false, false, false
  )
  ON CONFLICT DO NOTHING;

  -- Public calendar
  INSERT INTO public.calendars (user_id, name, type, color, is_active, enable_reminder, enable_overlap, is_occasions, is_personal_public)
  VALUES (
    NEW.user_id,
    v_name || ' (عمومی)',
    'public',
    '#10b981',
    true, false, true, false, true
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.create_default_calendars_for_user() OWNER TO postgres;

-- ════════════════════════════════════════════════════════════
-- 7. ensure_default_calendars_for_user — idempotent, ACTIVE only
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ensure_default_calendars_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_profile record;
  v_name text;
BEGIN
  SELECT user_id, full_name, email, account_status, is_active
  INTO v_profile
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_profile.account_status IS DISTINCT FROM 'ACTIVE' OR v_profile.is_active IS NOT TRUE THEN
    RETURN;
  END IF;

  v_name := COALESCE(NULLIF(TRIM(v_profile.full_name), ''), SPLIT_PART(COALESCE(v_profile.email, ''), '@', 1), 'کاربر');

  INSERT INTO public.calendars (user_id, name, type, color, is_active, enable_reminder, enable_overlap, is_occasions, is_personal_public)
  VALUES (
    p_user_id,
    v_name,
    'private',
    '#3b82f6',
    true, true, false, false, false
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.calendars (user_id, name, type, color, is_active, enable_reminder, enable_overlap, is_occasions, is_personal_public)
  VALUES (
    p_user_id,
    v_name || ' (عمومی)',
    'public',
    '#10b981',
    true, false, true, false, true
  )
  ON CONFLICT DO NOTHING;
END;
$function$;

ALTER FUNCTION public.ensure_default_calendars_for_user(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.ensure_default_calendars_for_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_default_calendars_for_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_calendars_for_user(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 8. on_auth_user_created_lifecycle_profile trigger
--    Creates profile atomically when registration_flow marker is present
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.on_auth_user_created_lifecycle_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_registration_flow text;
  v_settings record;
  v_account_status text;
  v_is_active boolean;
  v_completion_status text;
  v_phone_verified boolean := false;
  v_full_name text;
  v_username text;
  v_email text;
  v_phone text;
  v_first_name text;
  v_last_name text;
  v_normalized_username text;
  v_normalized_email text;
  v_normalized_phone text;
BEGIN
  v_registration_flow := NEW.raw_app_meta_data ->> 'registration_flow';

  -- Only proceed for known registration flows
  IF v_registration_flow IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_registration_flow NOT IN ('public_phone_v1', 'admin_created_v1') THEN
    RETURN NEW;
  END IF;

  -- Load settings
  SELECT
    COALESCE(registration_requires_admin_approval, false),
    COALESCE(require_profile_completion, false)
  INTO v_settings
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  -- Extract user metadata
  v_first_name := NEW.raw_user_meta_data ->> 'first_name';
  v_last_name := NEW.raw_user_meta_data ->> 'last_name';
  v_full_name := NEW.raw_user_meta_data ->> 'full_name';
  v_username := NEW.raw_user_meta_data ->> 'username';
  v_email := NEW.raw_user_meta_data ->> 'email';
  v_phone := NEW.raw_user_meta_data ->> 'phone';

  IF v_full_name IS NULL AND (v_first_name IS NOT NULL OR v_last_name IS NOT NULL) THEN
    v_full_name := trim(COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, ''));
  END IF;

  -- Normalize
  v_normalized_username := lower(trim(v_username));
  v_normalized_email := lower(trim(v_email));
  v_normalized_phone := public.normalize_iran_phone(v_phone);

  -- Determine if phone is verified
  IF NEW.phone_confirmed_at IS NOT NULL THEN
    v_phone_verified := true;
  END IF;

  -- Set lifecycle GUC so guard allows the insert
  PERFORM set_config('app.account_lifecycle_write', 'true', true);
  PERFORM set_config('app.profile_completion_write', 'true', true);

  IF v_registration_flow = 'public_phone_v1' THEN
    IF v_settings.registration_requires_admin_approval THEN
      v_account_status := 'PENDING_ADMIN_APPROVAL';
      v_is_active := false;
    ELSE
      v_account_status := 'ACTIVE';
      v_is_active := true;
    END IF;

    IF v_settings.require_profile_completion THEN
      v_completion_status := 'IN_PROGRESS';
    ELSE
      v_completion_status := 'COMPLETE';
    END IF;

    INSERT INTO public.profiles (
      user_id, full_name, username, email, phone,
      normalized_username, normalized_email, normalized_phone,
      account_status, is_active,
      profile_completion_status,
      phone_verified_at, email_verified_at,
      is_admin, is_security_admin, can_broadcast,
      mfa_enrollment_required,
      account_lifecycle_version, profile_completion_version,
      registration_source,
      account_status_changed_at, account_status_changed_by
    ) VALUES (
      NEW.id, v_full_name, v_username, v_email, v_phone,
      v_normalized_username, v_normalized_email, v_normalized_phone,
      v_account_status, v_is_active,
      v_completion_status,
      CASE WHEN v_phone_verified THEN now() ELSE NULL END,
      CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END,
      false, false, false,
      false,
      1, 1,
      'public_phone_registration',
      now(), NULL
    )
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    -- admin_created_v1
    INSERT INTO public.profiles (
      user_id, full_name, username, email, phone,
      normalized_username, normalized_email, normalized_phone,
      account_status, is_active,
      profile_completion_status,
      phone_verified_at, email_verified_at,
      is_admin, is_security_admin, can_broadcast,
      mfa_enrollment_required,
      account_lifecycle_version, profile_completion_version,
      registration_source,
      account_status_changed_at, account_status_changed_by
    ) VALUES (
      NEW.id, v_full_name, v_username, v_email, v_phone,
      v_normalized_username, v_normalized_email, v_normalized_phone,
      'ACTIVE', true,
      'COMPLETE',
      CASE WHEN v_phone_verified THEN now() ELSE NULL END,
      CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END,
      false, false, false,
      false,
      1, 1,
      'admin_created',
      now(), NULL
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- Reset GUC
  PERFORM set_config('app.account_lifecycle_write', 'false', true);
  PERFORM set_config('app.profile_completion_write', 'false', true);

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.on_auth_user_created_lifecycle_profile() OWNER TO postgres;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created_lifecycle_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_lifecycle_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.on_auth_user_created_lifecycle_profile();
