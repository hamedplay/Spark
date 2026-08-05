/*
# Phase 4 — Lifecycle Profile Completion Hardening

## Summary
- Replaces trigger to remove ON CONFLICT DO NOTHING and alias settings columns (Blocker 9)
- Replaces guard to add profile completion field allowlist (Blocker 14)
- Hardens profile completion RPCs with is_active check (Blocker 16)

## Safety
- No prior migration modified
- No data deleted/reset/truncated
- No MFA policy changed
- No production data changed
*/

-- ════════════════════════════════════════════════════════════
-- Blocker 9: Replace trigger — remove ON CONFLICT, alias columns
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



  -- Load settings with explicit variables and aliased table reference
  SELECT
    COALESCE(s.registration_requires_admin_approval, false),
    COALESCE(s.require_profile_completion, false)
  INTO
    v_requires_admin_approval,
    v_require_profile_completion
  FROM public.auth_security_settings s
  WHERE s.id = 1
  LIMIT 1;



  -- Extract user metadata
  v_first_name := NEW.raw_user_meta_data ->> 'first_name';


  v_last_name := NEW.raw_user_meta_data ->> 'last_name';


  v_full_name := NEW.raw_user_meta_data ->> 'full_name';


  v_username := NEW.raw_user_meta_data ->> 'username';


  v_email := NEW.raw_user_meta_data ->> 'email';


  v_phone := NEW.raw_user_meta_data ->> 'phone';



  IF v_full_name IS NULL AND (v_first_name IS NOT NULL OR v_last_name IS NOT NULL) THEN
    v_full_name := btrim(COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, ''));


  END IF;



  -- Set GUCs for lifecycle and completion writes
  PERFORM set_config('app.account_lifecycle_write', 'true', true);


  PERFORM set_config('app.profile_completion_write', 'true', true);



  IF v_registration_flow = 'public_phone_v1' THEN
    -- Parse challenge metadata exception-safe
    v_challenge_id := NULL;


    v_claim_id := NULL;


    v_identity_hash := NULL;



    BEGIN
      v_challenge_id := (NEW.raw_app_meta_data ->> 'registration_challenge_id')::uuid;


    EXCEPTION WHEN OTHERS THEN v_challenge_id := NULL;

 END;



    BEGIN
      v_claim_id := (NEW.raw_app_meta_data ->> 'registration_claim_id')::uuid;


    EXCEPTION WHEN OTHERS THEN v_claim_id := NULL;

 END;



    v_identity_hash := NEW.raw_app_meta_data ->> 'registration_identity_hash';



    -- Verify phone is confirmed
    IF NEW.phone_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'Phone must be confirmed for public registration';


    END IF;



    -- Validate required metadata
    IF v_full_name IS NULL OR btrim(v_full_name) = '' THEN
      RAISE EXCEPTION 'full_name is required for public registration';


    END IF;


    IF v_username IS NULL OR btrim(v_username) = '' THEN
      RAISE EXCEPTION 'username is required for public registration';


    END IF;


    IF v_email IS NULL OR btrim(v_email) = '' THEN
      RAISE EXCEPTION 'email is required for public registration';


    END IF;


    IF v_phone IS NULL OR btrim(v_phone) = '' THEN
      RAISE EXCEPTION 'phone is required for public registration';


    END IF;



    -- Canonical values
    v_normalized_username := lower(btrim(v_username));


    v_normalized_email := lower(btrim(v_email));


    v_normalized_phone := public.normalize_iran_phone(v_phone);


    IF v_normalized_phone = '' THEN
      v_normalized_phone := '+' || v_phone;


    END IF;



    -- Determine account status
    IF v_requires_admin_approval THEN
      v_account_status := 'PENDING_ADMIN_APPROVAL';


      v_is_active := false;


    ELSE
      v_account_status := 'ACTIVE';


      v_is_active := true;


    END IF;



    -- Determine completion status
    IF v_require_profile_completion THEN
      v_completion_status := 'IN_PROGRESS';


    ELSE
      v_completion_status := 'COMPLETE';


    END IF;



    v_phone_verified := true;



    -- Insert profile — NO ON CONFLICT, raise on conflict to rollback
    INSERT INTO public.profiles (
      user_id, full_name, username, email, phone,
      normalized_username, normalized_email, normalized_phone,
      account_status, is_active,
      profile_completion_status,
      phone_verified_at, email_verified_at,
      is_admin, is_security_admin, security_role_version,
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
      'public_phone',
      now(), NULL
    );



    -- Consume challenge in same transaction
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
        AND processing_claim_id = v_claim_id
        AND identity_hash = v_identity_hash
        AND processing_expires_at > now()
        AND created_user_id IS NULL;



      IF NOT FOUND THEN
        RAISE EXCEPTION 'Challenge consumption failed — cannot complete registration atomically';


      END IF;


    END IF;



    -- Audit events (sanitized)
    INSERT INTO public.security_audit_events (
      actor_user_id, target_user_id,
      event_type, event_category, severity,
      result, metadata
    ) VALUES (
      NULL, NEW.id,
      'registration_completed', 'access', 'info',
      'success', jsonb_build_object('flow', 'public_phone_v1')
    );



    IF v_requires_admin_approval THEN
      INSERT INTO public.security_audit_events (
        actor_user_id, target_user_id,
        event_type, event_category, severity,
        result, metadata
      ) VALUES (
        NULL, NEW.id,
        'account_pending_admin_approval', 'access', 'info',
        'success', jsonb_build_object('flow', 'public_phone_v1')
      );


    END IF;



  ELSIF v_registration_flow = 'admin_created_v1' THEN
    -- Admin-created user flow
    v_provision_is_admin := (NEW.raw_app_meta_data ->> 'provision_is_admin') = 'true';


    v_provisioned_by := NEW.raw_app_meta_data ->> 'provisioned_by';



    -- General admin flag only from app_metadata
    IF v_provision_is_admin THEN
      v_is_admin := true;


    ELSE
      v_is_admin := false;


    END IF;



    -- Canonical values
    v_normalized_username := lower(btrim(COALESCE(v_username, '')));


    v_normalized_email := lower(btrim(COALESCE(v_email, '')));


    v_normalized_phone := public.normalize_iran_phone(COALESCE(v_phone, ''));


    IF v_normalized_phone = '' AND v_phone IS NOT NULL THEN
      v_normalized_phone := '+' || v_phone;


    END IF;



    -- Insert profile — NO ON CONFLICT, raise on conflict to rollback
    INSERT INTO public.profiles (
      user_id, full_name, username, email, phone,
      normalized_username, normalized_email, normalized_phone,
      account_status, is_active,
      profile_completion_status,
      phone_verified_at, email_verified_at,
      is_admin, is_security_admin, security_role_version,
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
      CASE WHEN v_phone IS NOT NULL AND v_phone <> '' THEN now() ELSE NULL END,
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



    -- Audit event (sanitized)
    INSERT INTO public.security_audit_events (
      actor_user_id, target_user_id,
      event_type, event_category, severity,
      result, metadata
    ) VALUES (
      CASE WHEN v_provisioned_by IS NOT NULL THEN v_provisioned_by::uuid ELSE NULL END,
      NEW.id,
      'admin_user_created', 'access', 'info',
      'success', jsonb_build_object('flow', 'admin_created_v1', 'is_admin', v_is_admin)
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
-- Blocker 14: Replace guard — add profile completion field allowlist
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


  v_is_self boolean := false;


BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_lifecycle_write := COALESCE(current_setting('app.account_lifecycle_write', true), 'false') = 'true';


    v_completion_write := COALESCE(current_setting('app.profile_completion_write', true), 'false') = 'true';


    v_is_self := auth.uid() = NEW.user_id;



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
        -- Allow profile completion fields for self when GUC is set
        IF v_completion_write AND v_is_self THEN
          -- Only allow the completion allowlist fields;

 block everything else
          IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
          OR NEW.can_broadcast IS DISTINCT FROM OLD.can_broadcast
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


        ELSE
          RAISE EXCEPTION 'Not allowed to modify protected profile fields';


        END IF;


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
-- Blocker 16: Harden get_my_profile_completion_state with is_active check
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


  v_is_active boolean;


BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');


  END IF;



  BEGIN
    v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;


  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');


  END;



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
    account_status, is_active
  INTO
    v_user_id, v_full_name, v_username, v_email, v_phone, v_phone_verified_at,
    v_organization, v_position, v_department, v_employee_id,
    v_birth_date, v_gender, v_city, v_location, v_bio, v_website, v_linkedin_url,
    v_profile_completion_status, v_profile_completion_version,
    v_account_status, v_is_active
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;



  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');


  END IF;



  IF v_account_status IS DISTINCT FROM 'ACTIVE' OR v_is_active IS NOT TRUE THEN
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
-- Blocker 16: Harden save_my_profile_completion with is_active check
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_my_profile_completion(p_patch jsonb, p_expected_version bigint, p_mark_complete boolean DEFAULT false)
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



  BEGIN
    v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;


  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');


  END;



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


;
