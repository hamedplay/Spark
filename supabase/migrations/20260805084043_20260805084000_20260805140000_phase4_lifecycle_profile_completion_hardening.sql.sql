/*\n# Phase 4 — Lifecycle Profile Completion Hardening\n\n## Summary\n- Replaces trigger to remove ON CONFLICT DO NOTHING and alias settings columns (Blocker 9)\n- Replaces guard to add profile completion field allowlist (Blocker 14)\n- Hardens profile completion RPCs with is_active check (Blocker 16)\n\n## Safety\n- No prior migration modified\n- No data deleted/reset/truncated\n- No MFA policy changed\n- No production data changed\n*/\n\n-- ════════════════════════════════════════════════════════════\n-- Blocker 9: Replace trigger — remove ON CONFLICT, alias columns\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.on_auth_user_created_lifecycle_profile()\nRETURNS trigger\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_registration_flow text
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
\n\n  -- Load settings with explicit variables and aliased table reference\n  SELECT\n    COALESCE(s.registration_requires_admin_approval, false),\n    COALESCE(s.require_profile_completion, false)\n  INTO\n    v_requires_admin_approval,\n    v_require_profile_completion\n  FROM public.auth_security_settings s\n  WHERE s.id = 1\n  LIMIT 1
\n\n  -- Extract user metadata\n  v_first_name := NEW.raw_user_meta_data ->> 'first_name'
\n  v_last_name := NEW.raw_user_meta_data ->> 'last_name'
\n  v_full_name := NEW.raw_user_meta_data ->> 'full_name'
\n  v_username := NEW.raw_user_meta_data ->> 'username'
\n  v_email := NEW.raw_user_meta_data ->> 'email'
\n  v_phone := NEW.raw_user_meta_data ->> 'phone'
\n\n  IF v_full_name IS NULL AND (v_first_name IS NOT NULL OR v_last_name IS NOT NULL) THEN\n    v_full_name := btrim(COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, ''))
\n  END IF
\n\n  -- Set GUCs for lifecycle and completion writes\n  PERFORM set_config('app.account_lifecycle_write', 'true', true)
\n  PERFORM set_config('app.profile_completion_write', 'true', true)
\n\n  IF v_registration_flow = 'public_phone_v1' THEN\n    -- Parse challenge metadata exception-safe\n    v_challenge_id := NULL
\n    v_claim_id := NULL
\n    v_identity_hash := NULL
\n\n    BEGIN\n      v_challenge_id := (NEW.raw_app_meta_data ->> 'registration_challenge_id')::uuid
\n    EXCEPTION WHEN OTHERS THEN v_challenge_id := NULL
 END
\n\n    BEGIN\n      v_claim_id := (NEW.raw_app_meta_data ->> 'registration_claim_id')::uuid
\n    EXCEPTION WHEN OTHERS THEN v_claim_id := NULL
 END
\n\n    v_identity_hash := NEW.raw_app_meta_data ->> 'registration_identity_hash'
\n\n    -- Verify phone is confirmed\n    IF NEW.phone_confirmed_at IS NULL THEN\n      RAISE EXCEPTION 'Phone must be confirmed for public registration'
\n    END IF
\n\n    -- Validate required metadata\n    IF v_full_name IS NULL OR btrim(v_full_name) = '' THEN\n      RAISE EXCEPTION 'full_name is required for public registration'
\n    END IF
\n    IF v_username IS NULL OR btrim(v_username) = '' THEN\n      RAISE EXCEPTION 'username is required for public registration'
\n    END IF
\n    IF v_email IS NULL OR btrim(v_email) = '' THEN\n      RAISE EXCEPTION 'email is required for public registration'
\n    END IF
\n    IF v_phone IS NULL OR btrim(v_phone) = '' THEN\n      RAISE EXCEPTION 'phone is required for public registration'
\n    END IF
\n\n    -- Canonical values\n    v_normalized_username := lower(btrim(v_username))
\n    v_normalized_email := lower(btrim(v_email))
\n    v_normalized_phone := public.normalize_iran_phone(v_phone)
\n    IF v_normalized_phone = '' THEN\n      v_normalized_phone := '+' || v_phone
\n    END IF
\n\n    -- Determine account status\n    IF v_requires_admin_approval THEN\n      v_account_status := 'PENDING_ADMIN_APPROVAL'
\n      v_is_active := false
\n    ELSE\n      v_account_status := 'ACTIVE'
\n      v_is_active := true
\n    END IF
\n\n    -- Determine completion status\n    IF v_require_profile_completion THEN\n      v_completion_status := 'IN_PROGRESS'
\n    ELSE\n      v_completion_status := 'COMPLETE'
\n    END IF
\n\n    v_phone_verified := true
\n\n    -- Insert profile — NO ON CONFLICT, raise on conflict to rollback\n    INSERT INTO public.profiles (\n      user_id, full_name, username, email, phone,\n      normalized_username, normalized_email, normalized_phone,\n      account_status, is_active,\n      profile_completion_status,\n      phone_verified_at, email_verified_at,\n      is_admin, is_security_admin, security_role_version,\n      mfa_enrollment_required,\n      account_lifecycle_version, profile_completion_version,\n      registration_source,\n      account_status_changed_at, account_status_changed_by\n    ) VALUES (\n      NEW.id, v_full_name, v_username, v_email, v_phone,\n      v_normalized_username, v_normalized_email, v_normalized_phone,\n      v_account_status, v_is_active,\n      v_completion_status,\n      CASE WHEN v_phone_verified THEN now() ELSE NULL END,\n      CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END,\n      false, false, false,\n      false,\n      1, 1,\n      'public_phone',\n      now(), NULL\n    )
\n\n    -- Consume challenge in same transaction\n    IF v_challenge_id IS NOT NULL THEN\n      UPDATE public.public_registration_challenges\n      SET status = 'consumed',\n          created_user_id = NEW.id,\n          consumed_at = now(),\n          processing_claim_id = NULL,\n          processing_started_at = NULL,\n          processing_expires_at = NULL,\n          updated_at = now()\n      WHERE id = v_challenge_id\n        AND status = 'processing'\n        AND processing_claim_id = v_claim_id\n        AND identity_hash = v_identity_hash\n        AND processing_expires_at > now()\n        AND created_user_id IS NULL
\n\n      IF NOT FOUND THEN\n        RAISE EXCEPTION 'Challenge consumption failed — cannot complete registration atomically'
\n      END IF
\n    END IF
\n\n    -- Audit events (sanitized)\n    INSERT INTO public.security_audit_events (\n      actor_user_id, target_user_id,\n      event_type, event_category, severity,\n      result, metadata\n    ) VALUES (\n      NULL, NEW.id,\n      'registration_completed', 'access', 'info',\n      'success', jsonb_build_object('flow', 'public_phone_v1')\n    )
\n\n    IF v_requires_admin_approval THEN\n      INSERT INTO public.security_audit_events (\n        actor_user_id, target_user_id,\n        event_type, event_category, severity,\n        result, metadata\n      ) VALUES (\n        NULL, NEW.id,\n        'account_pending_admin_approval', 'access', 'info',\n        'success', jsonb_build_object('flow', 'public_phone_v1')\n      )
\n    END IF
\n\n  ELSIF v_registration_flow = 'admin_created_v1' THEN\n    -- Admin-created user flow\n    v_provision_is_admin := (NEW.raw_app_meta_data ->> 'provision_is_admin') = 'true'
\n    v_provisioned_by := NEW.raw_app_meta_data ->> 'provisioned_by'
\n\n    -- General admin flag only from app_metadata\n    IF v_provision_is_admin THEN\n      v_is_admin := true
\n    ELSE\n      v_is_admin := false
\n    END IF
\n\n    -- Canonical values\n    v_normalized_username := lower(btrim(COALESCE(v_username, '')))
\n    v_normalized_email := lower(btrim(COALESCE(v_email, '')))
\n    v_normalized_phone := public.normalize_iran_phone(COALESCE(v_phone, ''))
\n    IF v_normalized_phone = '' AND v_phone IS NOT NULL THEN\n      v_normalized_phone := '+' || v_phone
\n    END IF
\n\n    -- Insert profile — NO ON CONFLICT, raise on conflict to rollback\n    INSERT INTO public.profiles (\n      user_id, full_name, username, email, phone,\n      normalized_username, normalized_email, normalized_phone,\n      account_status, is_active,\n      profile_completion_status,\n      phone_verified_at, email_verified_at,\n      is_admin, is_security_admin, security_role_version,\n      mfa_enrollment_required,\n      account_lifecycle_version, profile_completion_version,\n      registration_source,\n      account_status_changed_at, account_status_changed_by,\n      organization, position, department, employee_id,\n      birth_date, gender, city, location, bio, website, linkedin_url, national_id\n    ) VALUES (\n      NEW.id, v_full_name, v_username, v_email, v_phone,\n      v_normalized_username, v_normalized_email, v_normalized_phone,\n      'ACTIVE', true,\n      'COMPLETE',\n      CASE WHEN v_phone IS NOT NULL AND v_phone <> '' THEN now() ELSE NULL END,\n      CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END,\n      v_is_admin, false, false,\n      false,\n      1, 1,\n      'admin_created',\n      now(), NULL,\n      COALESCE(NEW.raw_user_meta_data ->> 'organization', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'position', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'department', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'employee_id', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'birth_date', '')::date,\n      COALESCE(NEW.raw_user_meta_data ->> 'gender', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'city', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'location', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'bio', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'website', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'linkedin_url', ''),\n      COALESCE(NEW.raw_user_meta_data ->> 'national_id', '')\n    )
\n\n    -- Audit event (sanitized)\n    INSERT INTO public.security_audit_events (\n      actor_user_id, target_user_id,\n      event_type, event_category, severity,\n      result, metadata\n    ) VALUES (\n      CASE WHEN v_provisioned_by IS NOT NULL THEN v_provisioned_by::uuid ELSE NULL END,\n      NEW.id,\n      'admin_user_created', 'access', 'info',\n      'success', jsonb_build_object('flow', 'admin_created_v1', 'is_admin', v_is_admin)\n    )
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
\n\n-- ════════════════════════════════════════════════════════════\n-- Blocker 14: Replace guard — add profile completion field allowlist\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()\nRETURNS trigger\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_is_security_admin boolean := false
\n  v_lifecycle_write boolean := false
\n  v_completion_write boolean := false
\n  v_is_self boolean := false
\nBEGIN\n  IF auth.uid() IS NOT NULL THEN\n    v_lifecycle_write := COALESCE(current_setting('app.account_lifecycle_write', true), 'false') = 'true'
\n    v_completion_write := COALESCE(current_setting('app.profile_completion_write', true), 'false') = 'true'
\n    v_is_self := auth.uid() = NEW.user_id
\n\n    -- For general protected fields, is_admin is still sufficient\n    IF NOT public.is_current_user_admin() THEN\n      IF NEW.is_admin IS DISTINCT FROM OLD.is_admin\n      OR NEW.can_broadcast IS DISTINCT FROM OLD.can_broadcast\n      OR NEW.organization IS DISTINCT FROM OLD.organization\n      OR NEW.is_active IS DISTINCT FROM OLD.is_active\n      OR NEW.is_hidden IS DISTINCT FROM OLD.is_hidden\n      OR NEW.user_id IS DISTINCT FROM OLD.user_id\n      OR NEW.email IS DISTINCT FROM OLD.email\n      OR NEW.telegram_token IS DISTINCT FROM OLD.telegram_token\n      OR NEW.webhook_url IS DISTINCT FROM OLD.webhook_url\n      OR NEW.google_calendar_token IS DISTINCT FROM OLD.google_calendar_token\n      OR NEW.primary_position_id IS DISTINCT FROM OLD.primary_position_id\n      OR NEW.primary_unit_id IS DISTINCT FROM OLD.primary_unit_id\n      OR NEW.avatar_storage_path IS DISTINCT FROM OLD.avatar_storage_path\n      OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url\n      OR NEW.position IS DISTINCT FROM OLD.position\n      OR NEW.department IS DISTINCT FROM OLD.department\n      OR (NEW.username IS DISTINCT FROM OLD.username\n      AND NOT (OLD.username IS NULL AND NEW.username IS NOT NULL))\n      OR (NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id\n      AND NOT (OLD.telegram_chat_id IS NOT NULL AND NEW.telegram_chat_id IS NULL))\n      THEN\n        -- Allow profile completion fields for self when GUC is set\n        IF v_completion_write AND v_is_self THEN\n          -- Only allow the completion allowlist fields
 block everything else\n          IF NEW.is_admin IS DISTINCT FROM OLD.is_admin\n          OR NEW.can_broadcast IS DISTINCT FROM OLD.can_broadcast\n          OR NEW.is_active IS DISTINCT FROM OLD.is_active\n          OR NEW.is_hidden IS DISTINCT FROM OLD.is_hidden\n          OR NEW.user_id IS DISTINCT FROM OLD.user_id\n          OR NEW.email IS DISTINCT FROM OLD.email\n          OR NEW.telegram_token IS DISTINCT FROM OLD.telegram_token\n          OR NEW.webhook_url IS DISTINCT FROM OLD.webhook_url\n          OR NEW.google_calendar_token IS DISTINCT FROM OLD.google_calendar_token\n          OR NEW.primary_position_id IS DISTINCT FROM OLD.primary_position_id\n          OR NEW.primary_unit_id IS DISTINCT FROM OLD.primary_unit_id\n          OR NEW.avatar_storage_path IS DISTINCT FROM OLD.avatar_storage_path\n          OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url\n          OR NEW.position IS DISTINCT FROM OLD.position\n          OR NEW.department IS DISTINCT FROM OLD.department\n          OR (NEW.username IS DISTINCT FROM OLD.username\n          AND NOT (OLD.username IS NULL AND NEW.username IS NOT NULL))\n          OR (NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id\n          AND NOT (OLD.telegram_chat_id IS NOT NULL AND NEW.telegram_chat_id IS NULL))\n          THEN\n            RAISE EXCEPTION 'Not allowed to modify protected profile fields'
\n          END IF
\n        ELSE\n          RAISE EXCEPTION 'Not allowed to modify protected profile fields'
\n        END IF
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
\n\n-- ════════════════════════════════════════════════════════════\n-- Blocker 16: Harden get_my_profile_completion_state with is_active check\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.get_my_profile_completion_state()\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_uid uuid := auth.uid()
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
\n  v_is_active boolean
\nBEGIN\n  IF v_uid IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED')
\n  END IF
\n\n  BEGIN\n    v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid
\n  EXCEPTION WHEN OTHERS THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END
\n\n  IF v_session_id IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT EXISTS(\n    SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid\n  ) INTO v_session_exists
\n\n  IF NOT v_session_exists THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT not_after INTO v_session_not_after\n  FROM auth.sessions WHERE id = v_session_id LIMIT 1
\n\n  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END IF
\n\n  SELECT\n    user_id, full_name, username, email, phone, phone_verified_at,\n    organization, position, department, employee_id,\n    birth_date, gender, city, location, bio, website, linkedin_url,\n    profile_completion_status, profile_completion_version,\n    account_status, is_active\n  INTO\n    v_user_id, v_full_name, v_username, v_email, v_phone, v_phone_verified_at,\n    v_organization, v_position, v_department, v_employee_id,\n    v_birth_date, v_gender, v_city, v_location, v_bio, v_website, v_linkedin_url,\n    v_profile_completion_status, v_profile_completion_version,\n    v_account_status, v_is_active\n  FROM public.profiles\n  WHERE user_id = v_uid\n  LIMIT 1
\n\n  IF NOT FOUND THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND')
\n  END IF
\n\n  IF v_account_status IS DISTINCT FROM 'ACTIVE' OR v_is_active IS NOT TRUE THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_ACTIVE')
\n  END IF
\n\n  RETURN jsonb_build_object(\n    'ok', true,\n    'profile', jsonb_build_object(\n      'user_id', v_user_id,\n      'full_name', v_full_name,\n      'username', v_username,\n      'email', v_email,\n      'phone', v_phone,\n      'phone_verified_at', v_phone_verified_at,\n      'organization', v_organization,\n      'position', v_position,\n      'department', v_department,\n      'employee_id', v_employee_id,\n      'birth_date', v_birth_date,\n      'gender', v_gender,\n      'city', v_city,\n      'location', v_location,\n      'bio', v_bio,\n      'website', v_website,\n      'linkedin_url', v_linkedin_url,\n      'profile_completion_status', v_profile_completion_status,\n      'profile_completion_version', v_profile_completion_version,\n      'account_status', v_account_status\n    )\n  )
\nEND
\n$function$
\n\nALTER FUNCTION public.get_my_profile_completion_state() OWNER TO postgres
\nREVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM PUBLIC
\nREVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM anon
\nGRANT EXECUTE ON FUNCTION public.get_my_profile_completion_state() TO authenticated
\n\n-- ════════════════════════════════════════════════════════════\n-- Blocker 16: Harden save_my_profile_completion with is_active check\n-- ════════════════════════════════════════════════════════════\n\nCREATE OR REPLACE FUNCTION public.save_my_profile_completion(p_patch jsonb, p_expected_version bigint, p_mark_complete boolean DEFAULT false)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n  v_uid uuid := auth.uid()
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
\n\n  BEGIN\n    v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid
\n  EXCEPTION WHEN OTHERS THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
\n  END
\n\n  IF v_session_id IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID')
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
\n\n  -- Compute merged state for completion requirements check\n  FOREACH v_key IN ARRAY v_patch_keys LOOP\n    IF v_key = 'full_name' THEN v_full_name := p_patch ->> 'full_name'
\n    ELSIF v_key = 'username' THEN v_username := p_patch ->> 'username'
\n    ELSIF v_key = 'email' THEN v_email := p_patch ->> 'email'
\n    ELSIF v_key = 'phone' THEN v_phone := p_patch ->> 'phone'
\n    END IF
\n  END LOOP
\n\n  -- If mark_complete, check requirements on merged state BEFORE any write\n  IF p_mark_complete THEN\n    IF NULLIF(TRIM(COALESCE(v_full_name, '')), '') IS NULL\n    OR NULLIF(TRIM(COALESCE(v_username, '')), '') IS NULL\n    OR NULLIF(TRIM(COALESCE(v_email, '')), '') IS NULL\n    OR NULLIF(TRIM(COALESCE(v_phone, '')), '') IS NULL\n    OR v_phone_verified_at IS NULL\n    THEN\n      RETURN jsonb_build_object('ok', false, 'error', 'COMPLETION_REQUIREMENTS_NOT_MET')
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
\n\n  -- Execute single UPDATE\n  EXECUTE format('UPDATE public.profiles SET %s WHERE user_id = $%s', v_set_clauses, v_idx + (CASE WHEN p_mark_complete THEN 2 ELSE 1 END))\n  USING v_set_values, v_uid
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
\n