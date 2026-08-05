/*\n# Phase 4 — Lifecycle Profile Completion Hardening\n\n## Summary\nReplaces on_auth_user_created_lifecycle_profile trigger for atomic challenge\nfinalize, hardens guard_protected_profile_fields with strict GUC enforcement,\nadds NOT VALID consistency constraint, rewrites profile completion RPCs with\natomic single-UPDATE and session validation, hardens lifecycle setter with\nrequest_id try/catch, and adds history to lifecycle read model.\n\n## Safety\n- No prior migration modified\n- No data deleted\n- No MFA policy changed\n- No users created or modified\n- Existing inconsistent is_active record NOT auto-fixed\n*/\n\n-- ════════════════════════════════════════════════════════════\n-- 1. Replace guard_protected_profile_fields — strict GUC enforcement\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()\nRETURNS trigger\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_is_security_admin boolean := false
\n  v_lifecycle_write boolean := false
\n  v_completion_write boolean := false
\nBEGIN\n  IF auth.uid() IS NOT NULL THEN\n    v_lifecycle_write := COALESCE(current_setting('app.account_lifecycle_write', true), 'false') = 'true'
\n    v_completion_write := COALESCE(current_setting('app.profile_completion_write', true), 'false') = 'true'
\n\n    -- For general protected fields, is_admin is still sufficient\n    IF NOT public.is_current_user_admin() THEN\n      IF NEW.is_admin IS DISTINCT FROM OLD.is_admin\n      OR NEW.can_broadcast IS DISTINCT FROM OLD.can_broadcast\n      OR NEW.organization IS DISTINCT FROM OLD.organization\n      OR NEW.is_active IS DISTINCT FROM OLD.is_active\n      OR NEW.is_hidden IS DISTINCT FROM OLD.is_hidden\n      OR NEW.user_id IS DISTINCT FROM OLD.user_id\n      OR NEW.email IS DISTINCT FROM OLD.email\n      OR NEW.telegram_token IS DISTINCT FROM OLD.telegram_token\n      OR NEW.webhook_url IS DISTINCT FROM OLD.webhook_url\n      OR NEW.google_calendar_token IS DISTINCT FROM OLD.google_calendar_token\n      OR NEW.primary_position_id IS DISTINCT FROM OLD.primary_position_id\n      OR NEW.primary_unit_id IS DISTINCT FROM OLD.primary_unit_id\n      OR NEW.avatar_storage_path IS DISTINCT FROM OLD.avatar_storage_path\n      OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url\n      OR NEW.position IS DISTINCT FROM OLD.position\n      OR NEW.department IS DISTINCT FROM OLD.department\n      OR (NEW.username IS DISTINCT FROM OLD.username\n          AND NOT (OLD.username IS NULL AND NEW.username IS NOT NULL))\n      OR (NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id\n          AND NOT (OLD.telegram_chat_id IS NOT NULL AND NEW.telegram_chat_id IS NULL))\n      THEN\n        RAISE EXCEPTION 'Not allowed to modify protected profile fields'
\n      END IF
\n    END IF
\n\n    -- Security admin check\n    SELECT is_security_admin IS TRUE AND is_active IS TRUE AND account_status = 'ACTIVE'\n    INTO v_is_security_admin\n    FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
\n\n    -- Security column changes require security_admin (not just is_admin)\n    IF NOT v_is_security_admin OR auth.uid() = NEW.user_id THEN\n      IF NEW.account_status IS DISTINCT FROM OLD.account_status\n      OR NEW.mfa_enrollment_required IS DISTINCT FROM OLD.mfa_enrollment_required\n      OR NEW.normalized_username IS DISTINCT FROM OLD.normalized_username\n      OR NEW.normalized_email IS DISTINCT FROM OLD.normalized_email\n      OR NEW.normalized_phone IS DISTINCT FROM OLD.normalized_phone\n      OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at\n      OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at\n      OR NEW.is_security_admin IS DISTINCT FROM OLD.is_security_admin\n      OR NEW.security_role_version IS DISTINCT FROM OLD.security_role_version\n      THEN\n        RAISE EXCEPTION 'Not allowed to modify security profile fields'
\n      END IF
\n    END IF
\n\n    -- Lifecycle-only fields: require GUC, no exceptions for any admin\n    IF NOT v_lifecycle_write THEN\n      IF NEW.account_status IS DISTINCT FROM OLD.account_status\n      OR NEW.is_active IS DISTINCT FROM OLD.is_active\n      OR NEW.account_lifecycle_version IS DISTINCT FROM OLD.account_lifecycle_version\n      OR NEW.account_status_changed_at IS DISTINCT FROM OLD.account_status_changed_at\n      OR NEW.account_status_changed_by IS DISTINCT FROM OLD.account_status_changed_by\n      OR NEW.registration_source IS DISTINCT FROM OLD.registration_source\n      OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at\n      THEN\n        RAISE EXCEPTION 'Not allowed to modify account lifecycle fields'
\n      END IF
\n    END IF
\n\n    -- Completion-only fields: require GUC\n    IF NOT v_completion_write THEN\n      IF NEW.profile_completion_status IS DISTINCT FROM OLD.profile_completion_status\n      OR NEW.profile_completion_version IS DISTINCT FROM OLD.profile_completion_version\n      THEN\n        RAISE EXCEPTION 'Not allowed to modify profile completion fields'
\n      END IF
\n    END IF
\n\n    -- is_admin and is_security_admin are NOT affected by completion GUC\n    -- They remain protected by the security admin check above\n  END IF
\n  RETURN NEW
\nEND
\n$function$
\n\nALTER FUNCTION public.guard_protected_profile_fields() OWNER TO postgres
\n\n-- ════════════════════════════════════════════════════════════\n-- 2. Consistency constraint (NOT VALID — does not fix existing data)\n-- ════════════════════════════════════════════════════════════\n\nDO $$\nBEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM pg_constraint\n    WHERE conname = 'profiles_account_status_active_consistency'\n    AND conrelid = 'public.profiles'::regclass\n  ) THEN\n    ALTER TABLE public.profiles\n    ADD CONSTRAINT profiles_account_status_active_consistency\n    CHECK (\n      (account_status = 'ACTIVE' AND is_active IS TRUE)\n      OR\n      (account_status <> 'ACTIVE' AND is_active IS FALSE)\n    )\n    NOT VALID
\n  END IF
\nEND $$
\n\n-- ════════════════════════════════════════════════════════════\n-- 3. Replace on_auth_user_created_lifecycle_profile — atomic challenge finalize\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.on_auth_user_created_lifecycle_profile()\nRETURNS trigger\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_registration_flow text
\n  v_requires_admin_approval boolean := false
\n  v_require_profile_completion boolean := false
\n  v_account_status text
\n  v_is_active boolean
\n  v_completion_status text
\n  v_phone_verified boolean := false
\n  v_full_name text
\n  v_username text
\n  v_email text
\n  v_phone text
\n  v_first_name text
\n  v_last_name text
\n  v_normalized_username text
\n  v_normalized_email text
\n  v_normalized_phone text
\n  v_challenge_id uuid
\n  v_claim_id uuid
\n  v_identity_hash text
\n  v_provision_is_admin boolean := false
\n  v_provisioned_by text
\n  v_is_admin boolean := false
\nBEGIN\n  v_registration_flow := NEW.raw_app_meta_data ->> 'registration_flow'
\n\n  IF v_registration_flow IS NULL THEN\n    RETURN NEW
\n  END IF
\n  IF v_registration_flow NOT IN ('public_phone_v1', 'admin_created_v1') THEN\n    RETURN NEW
\n  END IF
\n\n  -- Load settings with explicit variables\n  SELECT\n    COALESCE(registration_requires_admin_approval, false),\n    COALESCE(require_profile_completion, false)\n  INTO\n    v_requires_admin_approval,\n    v_require_profile_completion\n  FROM public.auth_security_settings\n  WHERE id = 1\n  LIMIT 1
\n\n  -- Extract user metadata\n  v_first_name := NEW.raw_user_meta_data ->> 'first_name'
\n  v_last_name := NEW.raw_user_meta_data ->> 'last_name'
\n  v_full_name := NEW.raw_user_meta_data ->> 'full_name'
\n  v_username := NEW.raw_user_meta_data ->> 'username'
\n  v_email := NEW.raw_user_meta_data ->> 'email'
\n  v_phone := NEW.raw_user_meta_data ->> 'phone'
\n\n  IF v_full_name IS NULL AND (v_first_name IS NOT NULL OR v_last_name IS NOT NULL) THEN\n    v_full_name := trim(COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, ''))
\n  END IF
\n\n  -- Normalize\n  v_normalized_username := lower(trim(v_username))
\n  v_normalized_email := lower(trim(v_email))
\n  v_normalized_phone := public.normalize_iran_phone(v_phone)
\n\n  IF NEW.phone_confirmed_at IS NOT NULL THEN\n    v_phone_verified := true
\n  END IF
\n\n  -- Set GUCs so guard allows the insert\n  PERFORM set_config('app.account_lifecycle_write', 'true', true)
\n  PERFORM set_config('app.profile_completion_write', 'true', true)
\n\n  IF v_registration_flow = 'public_phone_v1' THEN\n    -- Parse challenge metadata with exception-safe parsing\n    BEGIN\n      v_challenge_id := NULLIF(NEW.raw_app_meta_data ->> 'registration_challenge_id', '')::uuid
\n    EXCEPTION WHEN OTHERS THEN v_challenge_id := NULL
 END
\n    BEGIN\n      v_claim_id := NULLIF(NEW.raw_app_meta_data ->> 'registration_claim_id', '')::uuid
\n    EXCEPTION WHEN OTHERS THEN v_claim_id := NULL
 END
\n    v_identity_hash := NEW.raw_app_meta_data ->> 'registration_identity_hash'
\n\n    -- Verify and finalize challenge atomically\n    IF v_challenge_id IS NOT NULL AND v_claim_id IS NOT NULL AND v_identity_hash IS NOT NULL THEN\n      DECLARE\n        v_challenge record
\n      BEGIN\n        SELECT * INTO v_challenge\n        FROM public.public_registration_challenges\n        WHERE id = v_challenge_id\n        FOR UPDATE
\n\n        IF NOT FOUND\n           OR v_challenge.status <> 'processing'\n           OR v_challenge.processing_claim_id IS DISTINCT FROM v_claim_id\n           OR v_challenge.identity_hash <> v_identity_hash\n           OR v_challenge.processing_expires_at <= now()\n           OR v_challenge.created_user_id IS NOT NULL\n        THEN\n          RAISE EXCEPTION 'CHALLENGE_FINALIZE_INVALID'
\n        END IF
\n\n        IF NEW.phone_confirmed_at IS NULL THEN\n          RAISE EXCEPTION 'PHONE_NOT_CONFIRMED'
\n        END IF
\n\n        -- Validate required user metadata\n        IF NULLIF(TRIM(COALESCE(v_full_name, '')), '') IS NULL\n           OR NULLIF(TRIM(COALESCE(v_username, '')), '') IS NULL\n           OR NULLIF(TRIM(COALESCE(v_email, '')), '') IS NULL\n        THEN\n          RAISE EXCEPTION 'REQUIRED_METADATA_MISSING'
\n        END IF
\n      END
\n    END IF
\n\n    IF v_requires_admin_approval THEN\n      v_account_status := 'PENDING_ADMIN_APPROVAL'
\n      v_is_active := false
\n    ELSE\n      v_account_status := 'ACTIVE'
\n      v_is_active := true
\n    END IF
\n\n    IF v_require_profile_completion THEN\n      v_completion_status := 'IN_PROGRESS'
\n    ELSE\n      v_completion_status := 'COMPLETE'
\n    END IF
\n\n    -- Insert profile (no ON CONFLICT — trigger should be the only writer)\n    INSERT INTO public.profiles (\n      user_id, full_name, username, email, phone,\n      normalized_username, normalized_email, normalized_phone,\n      account_status, is_active,\n      profile_completion_status,\n      phone_verified_at, email_verified_at,\n      is_admin, is_security_admin, can_broadcast,\n      mfa_enrollment_required,\n      account_lifecycle_version, profile_completion_version,\n      registration_source,\n      account_status_changed_at, account_status_changed_by\n    ) VALUES (\n      NEW.id, v_full_name, v_username, v_email, v_phone,\n      v_normalized_username, v_normalized_email, v_normalized_phone,\n      v_account_status, v_is_active,\n      v_completion_status,\n      CASE WHEN v_phone_verified THEN now() ELSE NULL END,\n      CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END,\n      false, false, false,\n      false,\n      1, 1,\n      'public_phone_registration',\n      now(), NULL\n    )
\n\n    -- Finalize challenge in same transaction\n    IF v_challenge_id IS NOT NULL THEN\n      UPDATE public.public_registration_challenges\n      SET status = 'consumed',\n          created_user_id = NEW.id,\n          consumed_at = now(),\n          processing_claim_id = NULL,\n          processing_started_at = NULL,\n          processing_expires_at = NULL,\n          updated_at = now()\n      WHERE id = v_challenge_id\n        AND status = 'processing'\n        AND processing_claim_id = v_claim_id
\n\n      IF NOT FOUND THEN\n        RAISE EXCEPTION 'CHALLENGE_FINALIZE_FAILED'
\n      END IF
\n    END IF
\n\n    -- Security audit (sanitized)\n    INSERT INTO public.security_audit_events (\n      actor_user_id, target_user_id,\n      event_type, event_category, severity,\n      result, metadata\n    ) VALUES (\n      NEW.id, NEW.id,\n      'registration_completed', 'auth', 'info',\n      'success',\n      public.sanitize_audit_metadata(jsonb_build_object(\n        'registration_source', 'public_phone_registration'\n      ))\n    )
\n\n    IF v_requires_admin_approval THEN\n      INSERT INTO public.security_audit_events (\n        actor_user_id, target_user_id,\n        event_type, event_category, severity,\n        result, metadata\n      ) VALUES (\n        NEW.id, NEW.id,\n        'account_pending_admin_approval', 'access', 'info',\n        'success',\n        public.sanitize_audit_metadata(jsonb_build_object(\n          'account_status', 'PENDING_ADMIN_APPROVAL'\n        ))\n      )
\n    END IF
\n\n  ELSE\n    -- admin_created_v1\n    -- Read provision fields from raw_app_meta_data (not user-editable)\n    v_provision_is_admin := COALESCE((NEW.raw_app_meta_data ->> 'provision_is_admin')::boolean, false)
\n    v_provisioned_by := NEW.raw_app_meta_data ->> 'provisioned_by'
\n    v_is_admin := v_provision_is_admin
\n\n    INSERT INTO public.profiles (\n      user_id, full_name, username, email, phone,\n      normalized_username, normalized_email, normalized_phone,\n      account_status, is_active,\n      profile_completion_status,\n      phone_verified_at, email_verified_at,\n      is_admin, is_security_admin, can_broadcast,\n      mfa_enrollment_required,\n      account_lifecycle_version, profile_completion_version,\n      registration_source,\n      account_status_changed_at, account_status_changed_by,\n      organization, position, department, employee_id,\n      birth_date, gender, city, location, bio, website, linkedin_url, national_id\n    ) VALUES (\n      NEW.id, v_full_name, v_username, v_email, v_phone,\n      v_normalized_username, v_normalized_email, v_normalized_phone,\n      'ACTIVE', true,\n      'COMPLETE',\n      CASE WHEN v_phone_verified THEN now() ELSE NULL END,\n      CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END,\n      v_is_admin, false, false,\n      false,\n      1, 1,\n      'admin_created',\n      now(), NULL,\n      COALESCE(NEW.raw_user_meta_data ->> 'organization', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'position', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'department', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'employee_id', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'birth_date', '')::date,\n      COALESCE(NEW.raw_user_meta_data ->> 'gender', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'city', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'location', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'bio', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'website', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'linkedin_url', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'national_id', '')\n    )
\n  END IF
\n\n  -- Reset GUCs\n  PERFORM set_config('app.account_lifecycle_write', 'false', true)
\n  PERFORM set_config('app.profile_completion_write', 'false', true)
\n\n  RETURN NEW
\n\nEXCEPTION WHEN OTHERS THEN\n  -- Reset GUCs on failure\n  PERFORM set_config('app.account_lifecycle_write', 'false', true)
\n  PERFORM set_config('app.profile_completion_write', 'false', true)
\n  RAISE
\nEND
\n$function$
\n\nALTER FUNCTION public.on_auth_user_created_lifecycle_profile() OWNER TO postgres
\n\n-- ════════════════════════════════════════════════════════════\n-- 4. Replace get_my_profile_completion_state — add session validation\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.get_my_profile_completion_state()\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_uid uuid := auth.uid()
\n  v_jwt jsonb := auth.jwt()
\n  v_session_id uuid
\n  v_session_exists boolean := false
\n  v_session_not_after timestamptz
\n  v_user_id text
\n  v_full_name text
\n  v_username text
\n  v_email text
\n  v_phone text
\n  v_phone_verified_at timestamptz
\n  v_organization text
\n  v_position text
\n  v_department text
\n  v_employee_id text
\n  v_birth_date date
\n  v_gender text
\n  v_city text
\n  v_location text
\n  v_bio text
\n  v_website text
\n  v_linkedin_url text
\n  v_profile_completion_status text
\n  v_profile_completion_version bigint
\n  v_account_status text
\nBEGIN\n  IF v_uid IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED')
\n  END IF
\n\n  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid
\n  IF v_session_id IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT EXISTS(\n    SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid\n  ) INTO v_session_exists
\n\n  IF NOT v_session_exists THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT not_after INTO v_session_not_after\n  FROM auth.sessions WHERE id = v_session_id LIMIT 1
\n\n  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT\n    user_id, full_name, username, email, phone, phone_verified_at,\n    organization, position, department, employee_id,\n    birth_date, gender, city, location, bio, website, linkedin_url,\n    profile_completion_status, profile_completion_version,\n    account_status\n  INTO\n    v_user_id, v_full_name, v_username, v_email, v_phone, v_phone_verified_at,\n    v_organization, v_position, v_department, v_employee_id,\n    v_birth_date, v_gender, v_city, v_location, v_bio, v_website, v_linkedin_url,\n    v_profile_completion_status, v_profile_completion_version,\n    v_account_status\n  FROM public.profiles\n  WHERE user_id = v_uid\n  LIMIT 1
\n\n  IF NOT FOUND THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND')
\n  END IF
\n\n  IF v_account_status IS DISTINCT FROM 'ACTIVE' THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE')
\n  END IF
\n\n  RETURN jsonb_build_object(\n    'ok', true,\n    'profile', jsonb_build_object(\n      'user_id', v_user_id,\n      'full_name', v_full_name,\n      'username', v_username,\n      'email', v_email,\n      'phone', v_phone,\n      'phone_verified_at', v_phone_verified_at,\n      'organization', v_organization,\n      'position', v_position,\n      'department', v_department,\n      'employee_id', v_employee_id,\n      'birth_date', v_birth_date,\n      'gender', v_gender,\n      'city', v_city,\n      'location', v_location,\n      'bio', v_bio,\n      'website', v_website,\n      'linkedin_url', v_linkedin_url,\n      'profile_completion_status', v_profile_completion_status,\n      'profile_completion_version', v_profile_completion_version,\n      'account_status', v_account_status\n    )\n  )
\nEND
\n$function$
\n\nALTER FUNCTION public.get_my_profile_completion_state() OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM anon
\nGRANT EXECUTE ON FUNCTION public.get_my_profile_completion_state() TO authenticated
\n\n-- ════════════════════════════════════════════════════════════\n-- 5. Replace save_my_profile_completion — atomic single UPDATE\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.save_my_profile_completion(\n  p_patch jsonb,\n  p_expected_version bigint,\n  p_mark_complete boolean DEFAULT false\n)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_uid uuid := auth.uid()
\n  v_jwt jsonb := auth.jwt()
\n  v_session_id uuid
\n  v_session_exists boolean := false
\n  v_session_not_after timestamptz
\n  v_full_name text
\n  v_username text
\n  v_email text
\n  v_phone text
\n  v_phone_verified_at timestamptz
\n  v_profile_completion_status text
\n  v_profile_completion_version bigint
\n  v_account_status text
\n  v_is_active boolean
\n  v_new_version bigint
\n  v_patch_keys text[]
\n  v_allowed_keys text[] := ARRAY[\n    'full_name', 'organization', 'position', 'department',\n    'employee_id', 'birth_date', 'gender', 'city', 'location',\n    'bio', 'website', 'linkedin_url'\n  ]
\n  v_key text
\n  v_set_clauses text := ''
\n  v_set_values jsonb := '[]'::jsonb
\n  v_idx int := 1
\nBEGIN\n  IF v_uid IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED')
\n  END IF
\n\n  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid
\n  IF v_session_id IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT EXISTS(\n    SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid\n  ) INTO v_session_exists
\n\n  IF NOT v_session_exists THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT not_after INTO v_session_not_after\n  FROM auth.sessions WHERE id = v_session_id LIMIT 1
\n\n  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  -- Validate p_patch is a JSON object\n  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PATCH')
\n  END IF
\n\n  -- Lock profile row\n  SELECT\n    full_name, username, email, phone, phone_verified_at,\n    profile_completion_status, profile_completion_version,\n    account_status, is_active\n  INTO\n    v_full_name, v_username, v_email, v_phone, v_phone_verified_at,\n    v_profile_completion_status, v_profile_completion_version,\n    v_account_status, v_is_active\n  FROM public.profiles\n  WHERE user_id = v_uid\n  FOR UPDATE
\n\n  IF NOT FOUND THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND')
\n  END IF
\n\n  IF v_account_status IS DISTINCT FROM 'ACTIVE' OR v_is_active IS NOT TRUE THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE')
\n  END IF
\n\n  IF v_profile_completion_version != p_expected_version THEN\n    RETURN jsonb_build_object(\n      'ok', false,\n      'error', 'VERSION_CONFLICT',\n      'current_version', v_profile_completion_version\n    )
\n  END IF
\n\n  -- Validate patch keys\n  v_patch_keys := ARRAY(SELECT jsonb_object_keys(p_patch))
\n  FOREACH v_key IN ARRAY v_patch_keys LOOP\n    IF NOT (v_key = ANY(v_allowed_keys)) THEN\n      RETURN jsonb_build_object('ok', false, 'error', 'FIELD_NOT_ALLOWED', 'field', v_key)
\n    END IF
\n  END LOOP
\n\n  -- Compute merged state for completion requirements check\n  -- Apply patch to local variables\n  FOREACH v_key IN ARRAY v_patch_keys LOOP\n    IF v_key = 'full_name' THEN v_full_name := p_patch ->> 'full_name'
\n    ELSIF v_key = 'username' THEN v_username := p_patch ->> 'username'
\n    ELSIF v_key = 'email' THEN v_email := p_patch ->> 'email'
\n    ELSIF v_key = 'phone' THEN v_phone := p_patch ->> 'phone'
\n    END IF
\n  END LOOP
\n\n  -- If mark_complete, check requirements on merged state BEFORE any write\n  IF p_mark_complete THEN\n    IF NULLIF(TRIM(COALESCE(v_full_name, '')), '') IS NULL\n       OR NULLIF(TRIM(COALESCE(v_username, '')), '') IS NULL\n       OR NULLIF(TRIM(COALESCE(v_email, '')), '') IS NULL\n       OR NULLIF(TRIM(COALESCE(v_phone, '')), '') IS NULL\n       OR v_phone_verified_at IS NULL\n    THEN\n      RETURN jsonb_build_object('ok', false, 'error', 'COMPLETION_REQUIREMENTS_NOT_MET')
\n    END IF
\n  END IF
\n\n  -- Build single UPDATE with all patch fields + version + status\n  v_new_version := v_profile_completion_version + 1
\n\n  PERFORM set_config('app.profile_completion_write', 'true', true)
\n\n  -- Build dynamic SET clause\n  FOREACH v_key IN ARRAY v_patch_keys LOOP\n    IF v_set_clauses <> '' THEN\n      v_set_clauses := v_set_clauses || ', '
\n    END IF
\n    v_set_clauses := v_set_clauses || format('%I = $%s', v_key, v_idx)
\n    v_set_values := v_set_values || jsonb_build_array(p_patch -> v_key)
\n    v_idx := v_idx + 1
\n  END LOOP
\n\n  -- Add version and status\n  IF v_set_clauses <> '' THEN\n    v_set_clauses := v_set_clauses || ', '
\n  END IF
\n\n  IF p_mark_complete THEN\n    v_set_clauses := v_set_clauses || format('profile_completion_status = $%s, profile_completion_version = $%s', v_idx, v_idx + 1)
\n    v_set_values := v_set_values || jsonb_build_array('COMPLETE') || jsonb_build_array(v_new_version)
\n  ELSE\n    IF v_profile_completion_status = 'NOT_STARTED' THEN\n      v_set_clauses := v_set_clauses || format('profile_completion_status = $%s, profile_completion_version = $%s', v_idx, v_idx + 1)
\n      v_set_values := v_set_values || jsonb_build_array('IN_PROGRESS') || jsonb_build_array(v_new_version)
\n    ELSE\n      v_set_clauses := v_set_clauses || format('profile_completion_version = $%s', v_idx)
\n      v_set_values := v_set_values || jsonb_build_array(v_new_version)
\n    END IF
\n  END IF
\n\n  -- Execute single UPDATE\n  EXECUTE format('UPDATE public.profiles SET %s WHERE user_id = $%s', v_set_clauses, v_idx + (CASE WHEN p_mark_complete THEN 2 ELSE 1 END))\n    USING v_set_values, v_uid
\n\n  PERFORM set_config('app.profile_completion_write', 'false', true)
\n\n  -- Audit\n  INSERT INTO public.security_audit_events (\n    actor_user_id, target_user_id,\n    event_type, event_category, severity,\n    result, metadata\n  ) VALUES (\n    v_uid, v_uid,\n    CASE WHEN p_mark_complete THEN 'profile_completion_completed' ELSE 'profile_completion_saved' END,\n    'access', 'info',\n    'success',\n    public.sanitize_audit_metadata(jsonb_build_object(\n      'action', CASE WHEN p_mark_complete THEN 'complete' ELSE 'save' END,\n      'new_version', v_new_version\n    ))\n  )
\n\n  RETURN jsonb_build_object(\n    'ok', true,\n    'new_version', v_new_version,\n    'profile_completion_status', CASE WHEN p_mark_complete THEN 'COMPLETE' ELSE 'IN_PROGRESS' END\n  )
\n\nEXCEPTION WHEN OTHERS THEN\n  PERFORM set_config('app.profile_completion_write', 'false', true)
\n  RAISE
\nEND
\n$function$
\n\nALTER FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) FROM anon
\nGRANT EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) TO authenticated
\n\n-- ════════════════════════════════════════════════════════════\n-- 6. Harden set_user_account_lifecycle_state — request_id try/catch\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.set_user_account_lifecycle_state(\n  p_target_user_id uuid,\n  p_action text,\n  p_expected_version bigint,\n  p_change_reason text DEFAULT NULL\n)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_uid uuid := auth.uid()
\n  v_jwt jsonb := auth.jwt()
\n  v_session_id uuid
\n  v_request_id uuid
\n  v_session_exists boolean := false
\n  v_session_not_after timestamptz
\n  v_target_rec record
\n  v_stepup_grant public.session_security_grants%ROWTYPE
\n  v_trimmed_reason text
\n  v_old_status text
\n  v_new_status text
\n  v_old_is_active boolean
\n  v_new_is_active boolean
\n  v_new_version bigint
\n  v_grant_consumed_count integer
\n  v_transition_ok boolean := false
\nBEGIN\n  IF v_uid IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED')
\n  END IF
\n\n  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid
\n  IF v_session_id IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED')
\n  END IF
\n\n  -- Parse request_id with try/catch\n  BEGIN\n    v_request_id := NULLIF(v_jwt ->> 'request_id', '')::uuid
\n  EXCEPTION WHEN OTHERS THEN v_request_id := NULL
 END
\n\n  SELECT EXISTS(\n    SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid\n  ) INTO v_session_exists
\n\n  IF NOT v_session_exists THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT not_after INTO v_session_not_after\n  FROM auth.sessions WHERE id = v_session_id LIMIT 1
\n\n  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED')
\n  END IF
\n\n  IF p_target_user_id IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_REQUIRED')
\n  END IF
\n\n  IF p_action IS NULL OR p_action NOT IN ('APPROVE', 'REJECT', 'REOPEN', 'SUSPEND', 'REACTIVATE') THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION')
\n  END IF
\n\n  IF p_expected_version IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'EXPECTED_VERSION_REQUIRED')
\n  END IF
\n\n  v_trimmed_reason := NULLIF(trim(COALESCE(p_change_reason, '')), '')
\n  IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) < 10 THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_REQUIRED')
\n  END IF
\n  IF length(v_trimmed_reason) > 500 THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'CHANGE_REASON_TOO_LONG')
\n  END IF
\n\n  IF p_target_user_id = v_uid THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_CHANGE_OWN_ACCOUNT')
\n  END IF
\n\n  IF NOT public.is_current_security_admin() THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED')
\n  END IF
\n\n  PERFORM pg_advisory_xact_lock(987654321)
\n\n  IF NOT public.is_current_security_admin() THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN')
\n  END IF
\n\n  SELECT\n    user_id, account_status, is_active, account_lifecycle_version, phone_verified_at\n  INTO v_target_rec\n  FROM public.profiles\n  WHERE user_id = p_target_user_id\n  FOR UPDATE
\n\n  IF NOT FOUND THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND')
\n  END IF
\n\n  v_old_status := v_target_rec.account_status
\n  v_old_is_active := v_target_rec.is_active
\n\n  CASE p_action\n    WHEN 'APPROVE' THEN\n      IF v_old_status = 'PENDING_ADMIN_APPROVAL' AND v_target_rec.phone_verified_at IS NOT NULL THEN\n        v_new_status := 'ACTIVE'
\n        v_new_is_active := true
\n        v_transition_ok := true
\n      END IF
\n    WHEN 'REJECT' THEN\n      IF v_old_status = 'PENDING_ADMIN_APPROVAL' THEN\n        v_new_status := 'REJECTED'
\n        v_new_is_active := false
\n        v_transition_ok := true
\n      END IF
\n    WHEN 'REOPEN' THEN\n      IF v_old_status = 'REJECTED' THEN\n        v_new_status := 'PENDING_ADMIN_APPROVAL'
\n        v_new_is_active := false
\n        v_transition_ok := true
\n      END IF
\n    WHEN 'SUSPEND' THEN\n      IF v_old_status = 'ACTIVE' THEN\n        v_new_status := 'SUSPENDED'
\n        v_new_is_active := false
\n        v_transition_ok := true
\n      END IF
\n    WHEN 'REACTIVATE' THEN\n      IF v_old_status = 'SUSPENDED' THEN\n        v_new_status := 'ACTIVE'
\n        v_new_is_active := true
\n        v_transition_ok := true
\n      END IF
\n  END CASE
\n\n  IF NOT v_transition_ok THEN\n    -- Denied audit for invalid transition\n    INSERT INTO public.security_audit_events (\n      actor_user_id, target_user_id,\n      event_type, event_category, severity,\n      session_id, request_id,\n      result, metadata\n    ) VALUES (\n      v_uid, p_target_user_id,\n      'lifecycle_transition_denied', 'access', 'warning',\n      v_session_id, v_request_id,\n      'failure',\n      public.sanitize_audit_metadata(jsonb_build_object(\n        'action', p_action,\n        'current_status', v_old_status\n      ))\n    )
\n    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION', 'current_status', v_old_status)
\n  END IF
\n\n  SELECT * INTO v_stepup_grant\n  FROM public.session_security_grants\n  WHERE user_id = v_uid\n    AND session_id = v_session_id\n    AND grant_type = 'mfa_stepup'\n    AND purpose = 'account_security_change'\n    AND factor_type = 'totp'\n    AND assurance_level = 'aal2'\n    AND consumed_at IS NULL\n    AND issued_at <= clock_timestamp()\n    AND issued_at >= clock_timestamp() - interval '5 minutes'\n    AND expires_at > clock_timestamp()\n  ORDER BY issued_at DESC\n  LIMIT 1\n  FOR UPDATE
\n\n  IF NOT FOUND THEN\n    -- Denied audit for missing step-up\n    INSERT INTO public.security_audit_events (\n      actor_user_id, target_user_id,\n      event_type, event_category, severity,\n      session_id, request_id,\n      result, metadata\n    ) VALUES (\n      v_uid, p_target_user_id,\n      'lifecycle_stepup_denied', 'access', 'warning',\n      v_session_id, v_request_id,\n      'failure',\n      public.sanitize_audit_metadata(jsonb_build_object(\n        'action', p_action\n      ))\n    )
\n    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED')
\n  END IF
\n\n  UPDATE public.session_security_grants\n  SET consumed_at = clock_timestamp()\n  WHERE id = v_stepup_grant.id\n    AND consumed_at IS NULL
\n\n  GET DIAGNOSTICS v_grant_consumed_count = ROW_COUNT
\n\n  IF v_grant_consumed_count = 0 THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED')
\n  END IF
\n\n  IF v_target_rec.account_lifecycle_version != p_expected_version THEN\n    -- Denied audit for version conflict\n    INSERT INTO public.security_audit_events (\n      actor_user_id, target_user_id,\n      event_type, event_category, severity,\n      session_id, request_id,\n      result, metadata\n    ) VALUES (\n      v_uid, p_target_user_id,\n      'lifecycle_version_conflict', 'access', 'warning',\n      v_session_id, v_request_id,\n      'failure',\n      public.sanitize_audit_metadata(jsonb_build_object(\n        'action', p_action,\n        'expected_version', p_expected_version,\n        'current_version', v_target_rec.account_lifecycle_version\n      ))\n    )
\n    RETURN jsonb_build_object(\n      'ok', false,\n      'error', 'VERSION_CONFLICT',\n      'current_version', v_target_rec.account_lifecycle_version\n    )
\n  END IF
\n\n  v_new_version := v_target_rec.account_lifecycle_version + 1
\n\n  PERFORM set_config('app.account_lifecycle_write', 'true', true)
\n\n  UPDATE public.profiles\n  SET\n    account_status = v_new_status,\n    is_active = v_new_is_active,\n    account_lifecycle_version = v_new_version,\n    account_status_changed_at = now(),\n    account_status_changed_by = v_uid\n  WHERE user_id = p_target_user_id
\n\n  PERFORM set_config('app.account_lifecycle_write', 'false', true)
\n\n  IF v_new_status = 'ACTIVE' THEN\n    PERFORM public.ensure_default_calendars_for_user(p_target_user_id)
\n  END IF
\n\n  INSERT INTO public.account_lifecycle_history (\n    target_user_id, actor_user_id,\n    old_status, new_status,\n    old_is_active, new_is_active,\n    old_version, new_version,\n    action, change_reason,\n    session_id, request_id\n  ) VALUES (\n    p_target_user_id, v_uid,\n    v_old_status, v_new_status,\n    v_old_is_active, v_new_is_active,\n    v_target_rec.account_lifecycle_version, v_new_version,\n    p_action, v_trimmed_reason,\n    v_session_id, v_request_id\n  )
\n\n  INSERT INTO public.security_audit_events (\n    actor_user_id, target_user_id,\n    event_type, event_category, severity,\n    session_id, request_id,\n    result, metadata\n  ) VALUES (\n    v_uid, p_target_user_id,\n    CASE p_action\n      WHEN 'APPROVE' THEN 'account_approved'\n      WHEN 'REJECT' THEN 'account_rejected'\n      WHEN 'REOPEN' THEN 'account_reopened'\n      WHEN 'SUSPEND' THEN 'account_suspended'\n      WHEN 'REACTIVATE' THEN 'account_reactivated'\n    END,\n    'access', 'warning',\n    v_session_id, v_request_id,\n    'success',\n    public.sanitize_audit_metadata(jsonb_build_object(\n      'action', p_action,\n      'old_status', v_old_status,\n      'new_status', v_new_status,\n      'new_version', v_new_version\n    ))\n  )
\n\n  RETURN jsonb_build_object(\n    'ok', true,\n    'new_version', v_new_version,\n    'new_status', v_new_status\n  )
\n\nEXCEPTION WHEN OTHERS THEN\n  PERFORM set_config('app.account_lifecycle_write', 'false', true)
\n  RAISE
\nEND
\n$function$
\n\nALTER FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) FROM anon
\nGRANT EXECUTE ON FUNCTION public.set_user_account_lifecycle_state(uuid, text, bigint, text) TO authenticated
\n\n-- ════════════════════════════════════════════════════════════\n-- 7. Replace get_account_lifecycle_management_state — add history, validate status/search\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.get_account_lifecycle_management_state(\n  p_status text DEFAULT NULL,\n  p_search text DEFAULT NULL,\n  p_limit integer DEFAULT 50,\n  p_offset integer DEFAULT 0\n)\nRETURNS jsonb\nLANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_uid uuid := auth.uid()
\n  v_jwt jsonb := auth.jwt()
\n  v_session_id uuid
\n  v_session_exists boolean := false
\n  v_session_not_after timestamptz
\n  v_search text
\n  v_limit int := COALESCE(p_limit, 50)
\n  v_offset int := COALESCE(p_offset, 0)
\n  v_users jsonb
\n  v_summary jsonb
\n  v_total_matches int
\n  v_has_more boolean := false
\n  v_pagination jsonb
\n  v_phone_unverified int
\n  v_pending int
\n  v_active int
\n  v_rejected int
\n  v_suspended int
\n  v_locked int
\n  v_history jsonb
\n  v_valid_statuses text[] := ARRAY['PHONE_UNVERIFIED', 'PENDING_ADMIN_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'LOCKED']
\nBEGIN\n  IF v_uid IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED')
\n  END IF
\n\n  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid
\n  IF v_session_id IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT EXISTS(\n    SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid\n  ) INTO v_session_exists
\n\n  IF NOT v_session_exists THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT not_after INTO v_session_not_after\n  FROM auth.sessions WHERE id = v_session_id LIMIT 1
\n\n  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  IF NOT public.is_current_security_admin() THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED')
\n  END IF
\n\n  -- Validate status filter\n  IF p_status IS NOT NULL AND NOT (p_status = ANY(v_valid_statuses)) THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS')
\n  END IF
\n\n  IF v_limit < 1 OR v_limit > 100 THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT')
\n  END IF
\n\n  IF v_offset < 0 OR v_offset > 10000 THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OFFSET')
\n  END IF
\n\n  -- Limit search to 100 chars\n  v_search := left(NULLIF(trim(COALESCE(p_search, '')), ''), 100)
\n\n  WITH filtered_users AS (\n    SELECT\n      p.user_id, p.full_name, p.username, p.email, p.phone,\n      p.account_status, p.is_active, p.phone_verified_at,\n      p.profile_completion_status, p.account_lifecycle_version,\n      p.created_at\n    FROM public.profiles p\n    WHERE (\n      p_status IS NULL OR p.account_status = p_status\n    )\n    AND (\n      v_search IS NULL\n      OR position(lower(v_search) in lower(COALESCE(p.full_name, ''))) > 0\n      OR position(lower(v_search) in lower(COALESCE(p.username, ''))) > 0\n    )\n  ),\n  page_plus_one AS (\n    SELECT * FROM filtered_users\n    ORDER BY\n      CASE account_status\n        WHEN 'PENDING_ADMIN_APPROVAL' THEN 0\n        WHEN 'PHONE_UNVERIFIED' THEN 1\n        WHEN 'ACTIVE' THEN 2\n        WHEN 'SUSPENDED' THEN 3\n        WHEN 'REJECTED' THEN 4\n        WHEN 'LOCKED' THEN 5\n      END,\n      full_name NULLS LAST,\n      user_id\n    LIMIT v_limit + 1\n    OFFSET v_offset\n  ),\n  visible_page AS (\n    SELECT * FROM page_plus_one\n    LIMIT v_limit\n  )\n  SELECT\n    COALESCE(\n      (\n        SELECT jsonb_agg(jsonb_build_object(\n          'user_id', vp.user_id,\n          'full_name', vp.full_name,\n          'username', vp.username,\n          'masked_email', public.mask_email(vp.email),\n          'masked_phone', public.mask_phone(vp.phone),\n          'account_status', vp.account_status,\n          'is_active', vp.is_active,\n          'phone_verified', vp.phone_verified_at IS NOT NULL,\n          'profile_completion_status', vp.profile_completion_status,\n          'account_lifecycle_version', vp.account_lifecycle_version,\n          'created_at', vp.created_at,\n          'eligibility', jsonb_build_object(\n            'can_approve', vp.account_status = 'PENDING_ADMIN_APPROVAL' AND vp.phone_verified_at IS NOT NULL,\n            'can_reject', vp.account_status = 'PENDING_ADMIN_APPROVAL',\n            'can_reopen', vp.account_status = 'REJECTED',\n            'can_suspend', vp.account_status = 'ACTIVE',\n            'can_reactivate', vp.account_status = 'SUSPENDED'\n          )\n        ) ORDER BY\n          CASE vp.account_status\n            WHEN 'PENDING_ADMIN_APPROVAL' THEN 0\n            WHEN 'PHONE_UNVERIFIED' THEN 1\n            WHEN 'ACTIVE' THEN 2\n            WHEN 'SUSPENDED' THEN 3\n            WHEN 'REJECTED' THEN 4\n            WHEN 'LOCKED' THEN 5\n          END,\n          vp.full_name NULLS LAST,\n          vp.user_id\n        )\n        FROM visible_page vp\n      ),\n      '[]'::jsonb\n    ),\n    (\n      SELECT count(*) > v_limit\n      FROM page_plus_one\n    ),\n    (\n      SELECT count(*)\n      FROM filtered_users\n    )\n  INTO\n    v_users,\n    v_has_more,\n    v_total_matches
\n\n  v_pagination := jsonb_build_object(\n    'limit', v_limit,\n    'offset', v_offset,\n    'has_more', v_has_more,\n    'total_matches', v_total_matches\n  )
\n\n  SELECT count(*) INTO v_phone_unverified FROM public.profiles WHERE account_status = 'PHONE_UNVERIFIED'
\n  SELECT count(*) INTO v_pending FROM public.profiles WHERE account_status = 'PENDING_ADMIN_APPROVAL'
\n  SELECT count(*) INTO v_active FROM public.profiles WHERE account_status = 'ACTIVE'
\n  SELECT count(*) INTO v_rejected FROM public.profiles WHERE account_status = 'REJECTED'
\n  SELECT count(*) INTO v_suspended FROM public.profiles WHERE account_status = 'SUSPENDED'
\n  SELECT count(*) INTO v_locked FROM public.profiles WHERE account_status = 'LOCKED'
\n\n  v_summary := jsonb_build_object(\n    'phone_unverified', v_phone_unverified,\n    'pending_approval', v_pending,\n    'active', v_active,\n    'rejected', v_rejected,\n    'suspended', v_suspended,\n    'locked', v_locked\n  )
\n\n  -- Recent history (max 50 rows)\n  SELECT COALESCE(\n    (\n      SELECT jsonb_agg(jsonb_build_object(\n        'target_user_id', h.target_user_id,\n        'target_display_name', COALESCE(p.full_name, p.username, ''),\n        'actor_user_id', h.actor_user_id,\n        'actor_display_name', COALESCE(ap.full_name, ap.username, ''),\n        'old_status', h.old_status,\n        'new_status', h.new_status,\n        'action', h.action,\n        'change_reason', h.change_reason,\n        'old_version', h.old_version,\n        'new_version', h.new_version,\n        'changed_at', h.changed_at\n      ) ORDER BY h.changed_at DESC)\n      FROM public.account_lifecycle_history h\n      LEFT JOIN public.profiles p ON p.user_id = h.target_user_id\n      LEFT JOIN public.profiles ap ON ap.user_id = h.actor_user_id\n      LIMIT 50\n    ),\n    '[]'::jsonb\n  ) INTO v_history
\n\n  RETURN jsonb_build_object(\n    'ok', true,\n    'users', v_users,\n    'pagination', v_pagination,\n    'summary', v_summary,\n    'history', v_history\n  )
\nEND
\n$function$
\n\nALTER FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) FROM anon
\nGRANT EXECUTE ON FUNCTION public.get_account_lifecycle_management_state(text, text, integer, integer) TO authenticated
\n