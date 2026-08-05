/*
# Phase 4 — Lifecycle Profile Completion Hardening

## Summary
Replaces on_auth_user_created_lifecycle_profile trigger for atomic challenge
finalize, hardens guard_protected_profile_fields with strict GUC enforcement,
adds NOT VALID consistency constraint, rewrites profile completion RPCs with
atomic single-UPDATE and session validation, hardens lifecycle setter with
request_id try/catch, and adds history to lifecycle read model.

## Safety
- No prior migration modified
- No data deleted
- No MFA policy changed
- No users created or modified
- Existing inconsistent is_active record NOT auto-fixed
*/

-- ════════════════════════════════════════════════════════════
-- 1. Replace guard_protected_profile_fields — strict GUC enforcement
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
    v_lifecycle_write := COALESCE(current_setting('app.account_lifecycle_write', true), 'false') = 'true';


    v_completion_write := COALESCE(current_setting('app.profile_completion_write', true), 'false') = 'true';



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



    -- Security admin check
    SELECT is_security_admin IS TRUE AND is_active IS TRUE AND account_status = 'ACTIVE'
    INTO v_is_security_admin
    FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;



    -- Security column changes require security_admin (not just is_admin)
    IF NOT v_is_security_admin OR auth.uid() = NEW.user_id THEN
      IF NEW.account_status IS DISTINCT FROM OLD.account_status
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



    -- Lifecycle-only fields: require GUC, no exceptions for any admin
    IF NOT v_lifecycle_write THEN
      IF NEW.account_status IS DISTINCT FROM OLD.account_status
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.account_lifecycle_version IS DISTINCT FROM OLD.account_lifecycle_version
      OR NEW.account_status_changed_at IS DISTINCT FROM OLD.account_status_changed_at
      OR NEW.account_status_changed_by IS DISTINCT FROM OLD.account_status_changed_by
      OR NEW.registration_source IS DISTINCT FROM OLD.registration_source
      OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at
      THEN
        RAISE EXCEPTION 'Not allowed to modify account lifecycle fields';


      END IF;


    END IF;



    -- Completion-only fields: require GUC
    IF NOT v_completion_write THEN
      IF NEW.profile_completion_status IS DISTINCT FROM OLD.profile_completion_status
      OR NEW.profile_completion_version IS DISTINCT FROM OLD.profile_completion_version
      THEN
        RAISE EXCEPTION 'Not allowed to modify profile completion fields';


      END IF;


    END IF;



    -- is_admin and is_security_admin are NOT affected by completion GUC
    -- They remain protected by the security admin check above
  END IF;


  RETURN NEW;


END;


$function$;



ALTER FUNCTION public.guard_protected_profile_fields() OWNER TO postgres;



-- ════════════════════════════════════════════════════════════
-- 2. Consistency constraint (NOT VALID — does not fix existing data)
-- ════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_account_status_active_consistency'
    AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_account_status_active_consistency
    CHECK (
      (account_status = 'ACTIVE' AND is_active IS TRUE)
      OR
      (account_status <> 'ACTIVE' AND is_active IS FALSE)
    )
    NOT VALID;


  END IF;


END $$;



-- ════════════════════════════════════════════════════════════
-- 3. Replace on_auth_user_created_lifecycle_profile — atomic challenge finalize
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.on_auth_user_created_lifecycle_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_registration_flow text;


  v_requires_admin_approval boolean := false;


  v_require_profile_completion boolean := false;


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


  v_challenge_id uuid;


  v_claim_id uuid;


  v_identity_hash text;


  v_provision_is_admin boolean := false;


  v_provisioned_by text;


  v_is_admin boolean := false;


BEGIN
  v_registration_flow := NEW.raw_app_meta_data ->> 'registration_flow';



  IF v_registration_flow IS NULL THEN
    RETURN NEW;


  END IF;


  IF v_registration_flow NOT IN ('public_phone_v1', 'admin_created_v1') THEN
    RETURN NEW;


  END IF;



  -- Load settings with explicit variables
  SELECT
    COALESCE(registration_requires_admin_approval, false),
    COALESCE(require_profile_completion, false)
  INTO
    v_requires_admin_approval,
    v_require_profile_completion
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



  IF NEW.phone_confirmed_at IS NOT NULL THEN
    v_phone_verified := true;


  END IF;



  -- Set GUCs so guard allows the insert
  PERFORM set_config('app.account_lifecycle_write', 'true', true);


  PERFORM set_config('app.profile_completion_write', 'true', true);



  IF v_registration_flow = 'public_phone_v1' THEN
    -- Parse challenge metadata with exception-safe parsing
    BEGIN
      v_challenge_id := NULLIF(NEW.raw_app_meta_data ->> 'registration_challenge_id', '')::uuid;


    EXCEPTION WHEN OTHERS THEN v_challenge_id := NULL;

 END;


    BEGIN
      v_claim_id := NULLIF(NEW.raw_app_meta_data ->> 'registration_claim_id', '')::uuid;


    EXCEPTION WHEN OTHERS THEN v_claim_id := NULL;

 END;


    v_identity_hash := NEW.raw_app_meta_data ->> 'registration_identity_hash';



    -- Verify and finalize challenge atomically
    IF v_challenge_id IS NOT NULL AND v_claim_id IS NOT NULL AND v_identity_hash IS NOT NULL THEN
      DECLARE
        v_challenge record;


      BEGIN
        SELECT * INTO v_challenge
        FROM public.public_registration_challenges
        WHERE id = v_challenge_id
        FOR UPDATE;



        IF NOT FOUND
           OR v_challenge.status <> 'processing'
           OR v_challenge.processing_claim_id IS DISTINCT FROM v_claim_id
           OR v_challenge.identity_hash <> v_identity_hash
           OR v_challenge.processing_expires_at <= now()
           OR v_challenge.created_user_id IS NOT NULL
        THEN
          RAISE EXCEPTION 'CHALLENGE_FINALIZE_INVALID';


        END IF;



        IF NEW.phone_confirmed_at IS NULL THEN
          RAISE EXCEPTION 'PHONE_NOT_CONFIRMED';


        END IF;



        -- Validate required user metadata
        IF NULLIF(TRIM(COALESCE(v_full_name, '')), '') IS NULL
           OR NULLIF(TRIM(COALESCE(v_username, '')), '') IS NULL
           OR NULLIF(TRIM(COALESCE(v_email, '')), '') IS NULL
        THEN
          RAISE EXCEPTION 'REQUIRED_METADATA_MISSING';


        END IF;


      END;


    END IF;



    IF v_requires_admin_approval THEN
      v_account_status := 'PENDING_ADMIN_APPROVAL';


      v_is_active := false;


    ELSE
      v_account_status := 'ACTIVE';


      v_is_active := true;


    END IF;



    IF v_require_profile_completion THEN
      v_completion_status := 'IN_PROGRESS';


    ELSE
      v_completion_status := 'COMPLETE';


    END IF;



    -- Insert profile (no ON CONFLICT — trigger should be the only writer)
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
    );



    -- Finalize challenge in same transaction
    IF v_challenge_id IS NOT NULL THEN
      UPDATE public.public_registration_challenges
      SET status = 'consumed',
          created_user_id = NEW.id,
          consumed_at = now(),
          processing_claim_id = NULL,
          processing_started_at = NULL,
          processing_expires_at = NULL,
          updated_at = now()
      WHERE id = v_challenge_id
        AND status = 'processing'
        AND processing_claim_id = v_claim_id;



      IF NOT FOUND THEN
        RAISE EXCEPTION 'CHALLENGE_FINALIZE_FAILED';


      END IF;


    END IF;



    -- Security audit (sanitized)
    INSERT INTO public.security_audit_events (
      actor_user_id, target_user_id,
      event_type, event_category, severity,
      result, metadata
    ) VALUES (
      NEW.id, NEW.id,
      'registration_completed', 'auth', 'info',
      'success',
      public.sanitize_audit_metadata(jsonb_build_object(
        'registration_source', 'public_phone_registration'
      ))
    );



    IF v_requires_admin_approval THEN
      INSERT INTO public.security_audit_events (
        actor_user_id, target_user_id,
        event_type, event_category, severity,
        result, metadata
      ) VALUES (
        NEW.id, NEW.id,
        'account_pending_admin_approval', 'access', 'info',
        'success',
        public.sanitize_audit_metadata(jsonb_build_object(
          'account_status', 'PENDING_ADMIN_APPROVAL'
        ))
      );


    END IF;



  ELSE
    -- admin_created_v1
    -- Read provision fields from raw_app_meta_data (not user-editable)
    v_provision_is_admin := COALESCE((NEW.raw_app_meta_data ->> 'provision_is_admin')::boolean, false);


    v_provisioned_by := NEW.raw_app_meta_data ->> 'provisioned_by';


    v_is_admin := v_provision_is_admin;



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
      account_status_changed_at, account_status_changed_by,
      organization, position, department, employee_id,
      birth_date, gender, city, location, bio, website, linkedin_url, national_id
    ) VALUES (
      NEW.id, v_full_name, v_username, v_email, v_phone,
      v_normalized_username, v_normalized_email, v_normalized_phone,
      'ACTIVE', true,
      'COMPLETE',
      CASE WHEN v_phone_verified THEN now() ELSE NULL END,
      CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END,
      v_is_admin, false, false,
      false,
      1, 1,
      'admin_created',
      now(), NULL,
      COALESCE(NEW.raw_user_meta_data ->> 'organization', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'position', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'department', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'employee_id', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'birth_date', '')::date,
      COALESCE(NEW.raw_user_meta_data ->> 'gender', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'city', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'location', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'bio', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'website', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'linkedin_url', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'national_id', '')
    );


  END IF;



  -- Reset GUCs
  PERFORM set_config('app.account_lifecycle_write', 'false', true);


  PERFORM set_config('app.profile_completion_write', 'false', true);



  RETURN NEW;



EXCEPTION WHEN OTHERS THEN
  -- Reset GUCs on failure
  PERFORM set_config('app.account_lifecycle_write', 'false', true);


  PERFORM set_config('app.profile_completion_write', 'false', true);


  RAISE;


END;


$function$;



ALTER FUNCTION public.on_auth_user_created_lifecycle_profile() OWNER TO postgres;



-- ════════════════════════════════════════════════════════════
-- 4. Replace get_my_profile_completion_state — add session validation
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_profile_completion_state()
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


  v_session_not_after timestamptz;


  v_user_id text;


  v_full_name text;


  v_username text;


  v_email text;


  v_phone text;


  v_phone_verified_at timestamptz;


  v_organization text;


  v_position text;


  v_department text;


  v_employee_id text;


  v_birth_date date;


  v_gender text;


  v_city text;


  v_location text;


  v_bio text;


  v_website text;


  v_linkedin_url text;


  v_profile_completion_status text;


  v_profile_completion_version bigint;


  v_account_status text;


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



  SELECT
    user_id, full_name, username, email, phone, phone_verified_at,
    organization, position, department, employee_id,
    birth_date, gender, city, location, bio, website, linkedin_url,
    profile_completion_status, profile_completion_version,
    account_status
  INTO
    v_user_id, v_full_name, v_username, v_email, v_phone, v_phone_verified_at,
    v_organization, v_position, v_department, v_employee_id,
    v_birth_date, v_gender, v_city, v_location, v_bio, v_website, v_linkedin_url,
    v_profile_completion_status, v_profile_completion_version,
    v_account_status
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;



  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');


  END IF;



  IF v_account_status IS DISTINCT FROM 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE');


  END IF;



  RETURN jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'user_id', v_user_id,
      'full_name', v_full_name,
      'username', v_username,
      'email', v_email,
      'phone', v_phone,
      'phone_verified_at', v_phone_verified_at,
      'organization', v_organization,
      'position', v_position,
      'department', v_department,
      'employee_id', v_employee_id,
      'birth_date', v_birth_date,
      'gender', v_gender,
      'city', v_city,
      'location', v_location,
      'bio', v_bio,
      'website', v_website,
      'linkedin_url', v_linkedin_url,
      'profile_completion_status', v_profile_completion_status,
      'profile_completion_version', v_profile_completion_version,
      'account_status', v_account_status
    )
  );


END;


$function$;



ALTER FUNCTION public.get_my_profile_completion_state() OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM anon;


GRANT EXECUTE ON FUNCTION public.get_my_profile_completion_state() TO authenticated;



-- ════════════════════════════════════════════════════════════
-- 5. Replace save_my_profile_completion — atomic single UPDATE
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


  v_jwt jsonb := auth.jwt();


  v_session_id uuid;


  v_session_exists boolean := false;


  v_session_not_after timestamptz;


  v_full_name text;


  v_username text;


  v_email text;


  v_phone text;


  v_phone_verified_at timestamptz;


  v_profile_completion_status text;


  v_profile_completion_version bigint;


  v_account_status text;


  v_is_active boolean;


  v_new_version bigint;


  v_patch_keys text[];


  v_allowed_keys text[] := ARRAY[
    'full_name', 'organization', 'position', 'department',
    'employee_id', 'birth_date', 'gender', 'city', 'location',
    'bio', 'website', 'linkedin_url'
  ];


  v_key text;


  v_set_clauses text := '';


  v_set_values jsonb := '[]'::jsonb;


  v_idx int := 1;


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



  -- Validate p_patch is a JSON object
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PATCH');


  END IF;



  -- Lock profile row
  SELECT
    full_name, username, email, phone, phone_verified_at,
    profile_completion_status, profile_completion_version,
    account_status, is_active
  INTO
    v_full_name, v_username, v_email, v_phone, v_phone_verified_at,
    v_profile_completion_status, v_profile_completion_version,
    v_account_status, v_is_active
  FROM public.profiles
  WHERE user_id = v_uid
  FOR UPDATE;



  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');


  END IF;



  IF v_account_status IS DISTINCT FROM 'ACTIVE' OR v_is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE');


  END IF;



  IF v_profile_completion_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'VERSION_CONFLICT',
      'current_version', v_profile_completion_version
    );


  END IF;



  -- Validate patch keys
  v_patch_keys := ARRAY(SELECT jsonb_object_keys(p_patch));


  FOREACH v_key IN ARRAY v_patch_keys LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'FIELD_NOT_ALLOWED', 'field', v_key);


    END IF;


  END LOOP;



  -- Compute merged state for completion requirements check
  -- Apply patch to local variables
  FOREACH v_key IN ARRAY v_patch_keys LOOP
    IF v_key = 'full_name' THEN v_full_name := p_patch ->> 'full_name';


    ELSIF v_key = 'username' THEN v_username := p_patch ->> 'username';


    ELSIF v_key = 'email' THEN v_email := p_patch ->> 'email';


    ELSIF v_key = 'phone' THEN v_phone := p_patch ->> 'phone';


    END IF;


  END LOOP;



  -- If mark_complete, check requirements on merged state BEFORE any write
  IF p_mark_complete THEN
    IF NULLIF(TRIM(COALESCE(v_full_name, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(v_username, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(v_email, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(v_phone, '')), '') IS NULL
       OR v_phone_verified_at IS NULL
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'COMPLETION_REQUIREMENTS_NOT_MET');


    END IF;


  END IF;



  -- Build single UPDATE with all patch fields + version + status
  v_new_version := v_profile_completion_version + 1;



  PERFORM set_config('app.profile_completion_write', 'true', true);



  -- Build dynamic SET clause
  FOREACH v_key IN ARRAY v_patch_keys LOOP
    IF v_set_clauses <> '' THEN
      v_set_clauses := v_set_clauses || ', ';


    END IF;


    v_set_clauses := v_set_clauses || format('%I = $%s', v_key, v_idx);


    v_set_values := v_set_values || jsonb_build_array(p_patch -> v_key);


    v_idx := v_idx + 1;


  END LOOP;



  -- Add version and status
  IF v_set_clauses <> '' THEN
    v_set_clauses := v_set_clauses || ', ';


  END IF;



  IF p_mark_complete THEN
    v_set_clauses := v_set_clauses || format('profile_completion_status = $%s, profile_completion_version = $%s', v_idx, v_idx + 1);


    v_set_values := v_set_values || jsonb_build_array('COMPLETE') || jsonb_build_array(v_new_version);


  ELSE
    IF v_profile_completion_status = 'NOT_STARTED' THEN
      v_set_clauses := v_set_clauses || format('profile_completion_status = $%s, profile_completion_version = $%s', v_idx, v_idx + 1);


      v_set_values := v_set_values || jsonb_build_array('IN_PROGRESS') || jsonb_build_array(v_new_version);


    ELSE
      v_set_clauses := v_set_clauses || format('profile_completion_version = $%s', v_idx);


      v_set_values := v_set_values || jsonb_build_array(v_new_version);


    END IF;


  END IF;



  -- Execute single UPDATE
  EXECUTE format('UPDATE public.profiles SET %s WHERE user_id = $%s', v_set_clauses, v_idx + (CASE WHEN p_mark_complete THEN 2 ELSE 1 END))
    USING v_set_values, v_uid;



  PERFORM set_config('app.profile_completion_write', 'false', true);



  -- Audit
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



EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.profile_completion_write', 'false', true);


  RAISE;


END;


$function$;



ALTER FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) FROM anon;


GRANT EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) TO authenticated;



-- ════════════════════════════════════════════════════════════
-- 6. Harden set_user_account_lifecycle_state — request_id try/catch
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



  -- Parse request_id with try/catch
  BEGIN
    v_request_id := NULLIF(v_jwt ->> 'request_id', '')::uuid;


  EXCEPTION WHEN OTHERS THEN v_request_id := NULL;

 END;



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
    -- Denied audit for invalid transition
    INSERT INTO public.security_audit_events (
      actor_user_id, target_user_id,
      event_type, event_category, severity,
      session_id, request_id,
      result, metadata
    ) VALUES (
      v_uid, p_target_user_id,
      'lifecycle_transition_denied', 'access', 'warning',
      v_session_id, v_request_id,
      'failure',
      public.sanitize_audit_metadata(jsonb_build_object(
        'action', p_action,
        'current_status', v_old_status
      ))
    );


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
    -- Denied audit for missing step-up
    INSERT INTO public.security_audit_events (
      actor_user_id, target_user_id,
      event_type, event_category, severity,
      session_id, request_id,
      result, metadata
    ) VALUES (
      v_uid, p_target_user_id,
      'lifecycle_stepup_denied', 'access', 'warning',
      v_session_id, v_request_id,
      'failure',
      public.sanitize_audit_metadata(jsonb_build_object(
        'action', p_action
      ))
    );


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
    -- Denied audit for version conflict
    INSERT INTO public.security_audit_events (
      actor_user_id, target_user_id,
      event_type, event_category, severity,
      session_id, request_id,
      result, metadata
    ) VALUES (
      v_uid, p_target_user_id,
      'lifecycle_version_conflict', 'access', 'warning',
      v_session_id, v_request_id,
      'failure',
      public.sanitize_audit_metadata(jsonb_build_object(
        'action', p_action,
        'expected_version', p_expected_version,
        'current_version', v_target_rec.account_lifecycle_version
      ))
    );


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



EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.account_lifecycle_write', 'false', true);


  RAISE;


END;


$function$;



ALTER FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) FROM anon;


GRANT EXECUTE ON FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) TO authenticated;



-- ════════════════════════════════════════════════════════════
-- 7. Replace get_account_lifecycle_management_state — add history, validate status/search
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


  v_history jsonb;


  v_valid_statuses text[] := ARRAY['PHONE_UNVERIFIED', 'PENDING_ADMIN_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'LOCKED'];


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



  -- Validate status filter
  IF p_status IS NOT NULL AND NOT (p_status = ANY(v_valid_statuses)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');


  END IF;



  IF v_limit < 1 OR v_limit > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT');


  END IF;



  IF v_offset < 0 OR v_offset > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OFFSET');


  END IF;



  -- Limit search to 100 chars
  v_search := left(NULLIF(trim(COALESCE(p_search, '')), ''), 100);



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



  -- Recent history (max 50 rows)
  SELECT COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object(
        'target_user_id', h.target_user_id,
        'target_display_name', COALESCE(p.full_name, p.username, ''),
        'actor_user_id', h.actor_user_id,
        'actor_display_name', COALESCE(ap.full_name, ap.username, ''),
        'old_status', h.old_status,
        'new_status', h.new_status,
        'action', h.action,
        'change_reason', h.change_reason,
        'old_version', h.old_version,
        'new_version', h.new_version,
        'changed_at', h.changed_at
      ) ORDER BY h.changed_at DESC)
      FROM public.account_lifecycle_history h
      LEFT JOIN public.profiles p ON p.user_id = h.target_user_id
      LEFT JOIN public.profiles ap ON ap.user_id = h.actor_user_id
      LIMIT 50
    ),
    '[]'::jsonb
  ) INTO v_history;



  RETURN jsonb_build_object(
    'ok', true,
    'users', v_users,
    'pagination', v_pagination,
    'summary', v_summary,
    'history', v_history
  );


END;


$function$;



ALTER FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) OWNER TO postgres;


REVOKE EXECUTE ON FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) FROM PUBLIC;


REVOKE EXECUTE ON FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) FROM anon;


GRANT EXECUTE ON FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) TO authenticated;


;
