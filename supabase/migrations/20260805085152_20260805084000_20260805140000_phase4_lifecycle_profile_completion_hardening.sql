-- ============================================================================\n-- Migration: 20260805084000_20260805140000_phase4_lifecycle_profile_completion_hardening\n-- Phase 4: Account lifecycle + profile completion hardening\n--\n-- This migration hardens the account lifecycle and profile completion flows:\n--   1. on_auth_user_created_lifecycle_profile()\n--        Trigger fired on auth.users INSERT. Consumes the phone-verification\n--        challenge in the same transaction, seeds the profile row with fields\n--        provisioned by an admin (when applicable), records audit events for\n--        registration_completed and account_pending_admin_approval, and sets\n--        the GUCs that the guard function below requires.\n--   2. guard_protected_profile_fields()\n--        BEFORE INSERT/UPDATE trigger function on public.profiles that blocks\n--        writes to lifecycle/completion/role fields unless the appropriate GUC\n--        is set by a SECURITY DEFINER function, and blocks role fields\n--        unconditionally.\n--   3. get_my_profile_completion_state()\n--        RPC returning the caller's profile-completion state. Validates the\n--        session and account status before returning anything.\n--   4. save_my_profile_completion(p_patch, p_expected_version, p_mark_complete)\n--        RPC accepting a JSON patch + optimistic version. Validates session,\n--        account status, patch shape, and completion requirements before\n--        performing a single UPDATE.\n-- ============================================================================\n\n-- ============================================================================\n-- 1. on_auth_user_created_lifecycle_profile()\n-- ============================================================================\nCREATE OR REPLACE FUNCTION public.on_auth_user_created_lifecycle_profile()\nRETURNS trigger\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n    v_settings             record
\n    v_challenge_id         uuid
\n    v_claim_id             uuid
\n    v_raw_phone            text
\n    v_normalized_phone     text
\n    v_is_admin_created     boolean := false
\n    v_provision_is_admin   boolean := false
\n    v_provisioned_by       uuid
\n    v_requires_approval    boolean := false
\n    v_require_completion   boolean := false
\nBEGIN\n    -- Load the single-row security settings configuration.\n    SELECT *\n      INTO v_settings\n      FROM public.auth_security_settings s\n     WHERE s.id = 1
\n\n    IF v_settings IS NULL THEN\n        RAISE EXCEPTION 'auth_security_settings row not found (id=1)'
\n    END IF
\n\n    v_requires_approval  := COALESCE(v_settings.registration_requires_admin_approval, false)
\n    v_require_completion := COALESCE(v_settings.require_profile_completion, false)
\n\n    -- Only proceed when the user confirmed their phone during signup.\n    IF NEW.phone_confirmed_at IS NOT NULL THEN\n        -- Resolve the pending challenge id / claim id from raw metadata.\n        v_challenge_id := nullif(trim(NEW.raw_user_meta_data->>'challenge_id'), '')::uuid
\n        v_claim_id     := nullif(trim(NEW.raw_user_meta_data->>'claim_id'), '')::uuid
\n        v_raw_phone    := NEW.raw_user_meta_data->>'phone'
\n        v_normalized_phone := NEW.raw_user_meta_data->>'normalized_phone'
\n\n        -- Detect admin-provisioned signup.\n        v_is_admin_created := (NEW.raw_app_meta_data->>'registration_source') = 'admin_created_v1'
\n\n        IF v_is_admin_created THEN\n            v_provision_is_admin := COALESCE(\n                (NEW.raw_app_meta_data->>'provision_is_admin')::boolean, false)
\n            v_provisioned_by := nullif(\n                trim(NEW.raw_app_meta_data->>'provisioned_by'), '')::uuid
\n        END IF
\n\n        -- Allow the lifecycle + completion guard to accept this function's writes.\n        PERFORM set_config('app.account_lifecycle_write', 'true', true)
\n        PERFORM set_config('app.profile_completion_write', 'true', true)
\n\n        -- Seed the profile row. We intentionally do NOT use ON CONFLICT here:\n        -- the trigger runs exactly once per new auth user, so the row must not\n        -- already exist. A duplicate would surface as a hard error.\n        IF v_is_admin_created THEN\n            INSERT INTO public.profiles (\n                user_id,\n                account_status,\n                is_active,\n                account_lifecycle_version,\n                account_status_changed_at,\n                account_status_changed_by,\n                registration_source,\n                phone_verified_at,\n                phone,\n                normalized_phone,\n                organization,\n                position,\n                department,\n                employee_id,\n                birth_date,\n                gender,\n                city,\n                location,\n                bio,\n                website,\n                linkedin_url,\n                national_id,\n                is_admin,\n                is_security_admin,\n                security_role_version\n            )\n            VALUES (\n                NEW.id,\n                CASE WHEN v_requires_approval THEN 'pending_approval' ELSE 'active' END,\n                CASE WHEN v_requires_approval THEN false ELSE true END,\n                1,\n                now(),\n                v_provisioned_by,\n                'admin_created_v1',\n                NEW.phone_confirmed_at,\n                v_raw_phone,\n                v_normalized_phone,\n                NEW.raw_user_meta_data->>'organization',\n                NEW.raw_user_meta_data->>'position',\n                NEW.raw_user_meta_data->>'department',\n                NEW.raw_user_meta_data->>'employee_id',\n                nullif(NEW.raw_user_meta_data->>'birth_date','')::date,\n                NEW.raw_user_meta_data->>'gender',\n                NEW.raw_user_meta_data->>'city',\n                NEW.raw_user_meta_data->>'location',\n                NEW.raw_user_meta_data->>'bio',\n                NEW.raw_user_meta_data->>'website',\n                NEW.raw_user_meta_data->>'linkedin_url',\n                NEW.raw_user_meta_data->>'national_id',\n                false,\n                false,\n                1\n            )
\n        ELSE\n            INSERT INTO public.profiles (\n                user_id,\n                account_status,\n                is_active,\n                account_lifecycle_version,\n                account_status_changed_at,\n                account_status_changed_by,\n                registration_source,\n                phone_verified_at,\n                phone,\n                normalized_phone,\n                is_admin,\n                is_security_admin,\n                security_role_version\n            )\n            VALUES (\n                NEW.id,\n                CASE WHEN v_requires_approval THEN 'pending_approval' ELSE 'active' END,\n                CASE WHEN v_requires_approval THEN false ELSE true END,\n                1,\n                now(),\n                NEW.id,\n                'self_signup_v1',\n                NEW.phone_confirmed_at,\n                v_raw_phone,\n                v_normalized_phone,\n                false,\n                false,\n                1\n            )
\n        END IF
\n\n        -- Consume the challenge atomically in the same transaction. The claim\n        -- must still be processing, not expired, and not yet bound to a user.\n        UPDATE public.challenges\n           SET status = 'consumed',\n               created_user_id = NEW.id\n         WHERE id = v_challenge_id\n           AND status = 'processing'\n           AND processing_claim_id = v_claim_id\n           AND processing_expires_at > now()\n           AND created_user_id IS NULL
\n\n        IF NOT FOUND THEN\n            RAISE EXCEPTION\n                'challenge % could not be consumed (expired, already consumed, or not in processing state)',\n                v_challenge_id\n                USING ERRCODE = 'check_violation'
\n        END IF
\n\n        -- Audit: registration completed.\n        INSERT INTO public.audit_events (\n            actor_id, event_type, target_id, metadata, created_at\n        )\n        VALUES (\n            NEW.id,\n            'registration_completed',\n            NEW.id,\n            jsonb_build_object(\n                'registration_source', NEW.raw_app_meta_data->>'registration_source',\n                'phone_confirmed_at', NEW.phone_confirmed_at,\n                'requires_admin_approval', v_requires_approval\n            ),\n            now()\n        )
\n\n        -- Audit: pending admin approval (only when the setting requires it).\n        IF v_requires_approval THEN\n            INSERT INTO public.audit_events (\n                actor_id, event_type, target_id, metadata, created_at\n            )\n            VALUES (\n                v_provisioned_by,\n                'account_pending_admin_approval',\n                NEW.id,\n                jsonb_build_object(\n                    'registration_source', NEW.raw_app_meta_data->>'registration_source',\n                    'provisioned_by', v_provisioned_by,\n                    'provision_is_admin', v_provision_is_admin\n                ),\n                now()\n            )
\n        END IF
\n    END IF
\n\n    RETURN NEW
\n\nEXCEPTION\n    WHEN OTHERS THEN\n        -- Reset the GUCs so no state leaks if we bail mid-function.\n        PERFORM set_config('app.account_lifecycle_write', 'false', true)
\n        PERFORM set_config('app.profile_completion_write', 'false', true)
\n        RAISE
\nEND
\n$function$
\n\n-- ============================================================================\n-- 2. guard_protected_profile_fields()\n-- ============================================================================\nCREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()\nRETURNS trigger\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n    v_lifecycle_write     text
\n    v_completion_write    text
\n    v_is_self             boolean := false
\nBEGIN\n    v_lifecycle_write  := current_setting('app.account_lifecycle_write', true)
\n    v_completion_write := current_setting('app.profile_completion_write', true)
\n\n    -- Determine whether the caller is the owner of this profile row.\n    v_is_self := (auth.uid() = NEW.user_id)
\n\n    -- --------------------------------------------------------------------\n    -- Lifecycle fields: only writable when the lifecycle GUC is set.\n    -- --------------------------------------------------------------------\n    IF v_lifecycle_write IS DISTINCT FROM 'true' THEN\n        IF TG_OP = 'UPDATE' THEN\n            IF NEW.account_status              IS DISTINCT FROM OLD.account_status\n               OR NEW.is_active                IS DISTINCT FROM OLD.is_active\n               OR NEW.account_lifecycle_version IS DISTINCT FROM OLD.account_lifecycle_version\n               OR NEW.account_status_changed_at IS DISTINCT FROM OLD.account_status_changed_at\n               OR NEW.account_status_changed_by IS DISTINCT FROM OLD.account_status_changed_by\n               OR NEW.registration_source       IS DISTINCT FROM OLD.registration_source\n               OR NEW.phone_verified_at         IS DISTINCT FROM OLD.phone_verified_at\n            THEN\n                RAISE EXCEPTION 'direct write to protected lifecycle fields is not permitted'\n                    USING ERRCODE = 'check_violation'
\n            END IF
\n        ELSE\n            IF NEW.account_status IS NOT NULL\n               OR NEW.is_active IS NOT NULL\n               OR NEW.account_lifecycle_version IS NOT NULL\n               OR NEW.account_status_changed_at IS NOT NULL\n               OR NEW.account_status_changed_by IS NOT NULL\n               OR NEW.registration_source IS NOT NULL\n               OR NEW.phone_verified_at IS NOT NULL\n            THEN\n                RAISE EXCEPTION 'direct write to protected lifecycle fields is not permitted'\n                    USING ERRCODE = 'check_violation'
\n            END IF
\n        END IF
\n    END IF
\n\n    -- --------------------------------------------------------------------\n    -- Completion fields: writable only with the completion GUC AND self.\n    -- --------------------------------------------------------------------\n    IF NOT (v_completion_write = 'true' AND v_is_self) THEN\n        IF TG_OP = 'UPDATE' THEN\n            IF NEW.profile_completion_status   IS DISTINCT FROM OLD.profile_completion_status\n               OR NEW.profile_completion_version IS DISTINCT FROM OLD.profile_completion_version\n            THEN\n                RAISE EXCEPTION 'direct write to protected completion fields is not permitted'\n                    USING ERRCODE = 'check_violation'
\n            END IF
\n        ELSE\n            IF NEW.profile_completion_status IS NOT NULL\n               OR NEW.profile_completion_version IS NOT NULL\n            THEN\n                RAISE EXCEPTION 'direct write to protected completion fields is not permitted'\n                    USING ERRCODE = 'check_violation'
\n            END IF
\n        END IF
\n    END IF
\n\n    -- --------------------------------------------------------------------\n    -- Role / normalized identity fields: never writable from client context,\n    -- even when the lifecycle or completion GUC is set.\n    -- --------------------------------------------------------------------\n    IF TG_OP = 'UPDATE' THEN\n        IF NEW.is_admin              IS DISTINCT FROM OLD.is_admin\n           OR NEW.is_security_admin  IS DISTINCT FROM OLD.is_security_admin\n           OR NEW.security_role_version IS DISTINCT FROM OLD.security_role_version\n           OR NEW.normalized_username IS DISTINCT FROM OLD.normalized_username\n           OR NEW.normalized_email    IS DISTINCT FROM OLD.normalized_email\n           OR NEW.normalized_phone    IS DISTINCT FROM OLD.normalized_phone\n        THEN\n            RAISE EXCEPTION 'direct write to role / normalized identity fields is not permitted'\n                USING ERRCODE = 'check_violation'
\n        END IF
\n    ELSE\n        IF NEW.is_admin IS NOT NULL\n           OR NEW.is_security_admin IS NOT NULL\n           OR NEW.security_role_version IS NOT NULL\n           OR NEW.normalized_username IS NOT NULL\n           OR NEW.normalized_email IS NOT NULL\n           OR NEW.normalized_phone IS NOT NULL\n        THEN\n            RAISE EXCEPTION 'direct write to role / normalized identity fields is not permitted'\n                USING ERRCODE = 'check_violation'
\n        END IF
\n    END IF
\n\n    RETURN NEW
\nEND
\n$function$
\n\nALTER FUNCTION public.guard_protected_profile_fields() OWNER TO postgres
\n\n-- ============================================================================\n-- 3. get_my_profile_completion_state()\n-- ============================================================================\nCREATE OR REPLACE FUNCTION public.get_my_profile_completion_state()\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n    v_session_user_id  uuid
\n    v_parsed_user_id   uuid
\n    v_is_active        boolean
\n    v_result           jsonb
\nBEGIN\n    -- Session validation with exception-safe UUID parsing.\n    BEGIN\n        v_session_user_id := auth.uid()
\n        v_parsed_user_id  := v_session_user_id::uuid
\n    EXCEPTION\n        WHEN invalid_text_representation OR others THEN\n            RETURN jsonb_build_object(\n                'status', 'ERROR',\n                'code', 'SESSION_INVALID',\n                'message', 'No valid session.'\n            )
\n    END
\n\n    IF v_parsed_user_id IS NULL THEN\n        RETURN jsonb_build_object(\n            'status', 'ERROR',\n            'code', 'SESSION_INVALID',\n            'message', 'No valid session.'\n        )
\n    END IF
\n\n    -- Account status gate.\n    SELECT p.is_active\n      INTO v_is_active\n      FROM public.profiles p\n     WHERE p.user_id = v_parsed_user_id\n     LIMIT 1
\n\n    IF v_is_active IS NOT TRUE THEN\n        RETURN jsonb_build_object(\n            'status', 'ERROR',\n            'code', 'ACCOUNT_NOT_ACTIVE',\n            'message', 'Account is not active.'\n        )
\n    END IF
\n\n    -- Return the completion state payload.\n    SELECT jsonb_build_object(\n        'status', 'OK',\n        'user_id', p.user_id,\n        'profile_completion_status', p.profile_completion_status,\n        'profile_completion_version', p.profile_completion_version,\n        'fields', jsonb_build_object(\n            'full_name', p.full_name,\n            'organization', p.organization,\n            'position', p.position,\n            'phone_verified_at', p.phone_verified_at\n        )\n    )\n      INTO v_result\n      FROM public.profiles p\n     WHERE p.user_id = v_parsed_user_id\n     LIMIT 1
\n\n    RETURN COALESCE(v_result, jsonb_build_object(\n        'status', 'ERROR',\n        'code', 'PROFILE_NOT_FOUND',\n        'message', 'Profile row not found.'\n    ))
\nEND
\n$function$
\n\nREVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM PUBLIC, anon
\nGRANT EXECUTE ON FUNCTION public.get_my_profile_completion_state() TO authenticated
\n\n-- ============================================================================\n-- 4. save_my_profile_completion(p_patch, p_expected_version, p_mark_complete)\n-- ============================================================================\nCREATE OR REPLACE FUNCTION public.save_my_profile_completion(\n    p_patch            jsonb,\n    p_expected_version bigint,\n    p_mark_complete    boolean\n)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\nAS $function$\nDECLARE\n    v_session_user_id   uuid
\n    v_parsed_user_id    uuid
\n    v_is_active         boolean
\n    v_current_version   bigint
\n    v_merged            jsonb
\n    v_set_clauses       text
\n    v_full_name         text
\n    v_organization      text
\n    v_position          text
\n    v_phone_verified_at timestamptz
\n    v_rows_updated      bigint
\nBEGIN\n    -- Session validation with exception-safe UUID parsing.\n    BEGIN\n        v_session_user_id := auth.uid()
\n        v_parsed_user_id  := v_session_user_id::uuid
\n    EXCEPTION\n        WHEN invalid_text_representation OR others THEN\n            RETURN jsonb_build_object(\n                'status', 'ERROR',\n                'code', 'SESSION_INVALID',\n                'message', 'No valid session.'\n            )
\n    END
\n\n    IF v_parsed_user_id IS NULL THEN\n        RETURN jsonb_build_object(\n            'status', 'ERROR',\n            'code', 'SESSION_INVALID',\n            'message', 'No valid session.'\n        )
\n    END IF
\n\n    -- Validate the patch is a JSON object.\n    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN\n        RETURN jsonb_build_object(\n            'status', 'ERROR',\n            'code', 'INVALID_PATCH',\n            'message', 'Patch must be a JSON object.'\n        )
\n    END IF
\n\n    -- Account status gate + row lock.\n    SELECT p.is_active, p.profile_completion_version\n      INTO v_is_active, v_current_version\n      FROM public.profiles p\n     WHERE p.user_id = v_parsed_user_id\n     FOR UPDATE
\n\n    IF v_is_active IS NOT TRUE THEN\n        RETURN jsonb_build_object(\n            'status', 'ERROR',\n            'code', 'ACCOUNT_NOT_ACTIVE',\n            'message', 'Account is not active.'\n        )
\n    END IF
\n\n    -- Optimistic concurrency check.\n    IF p_expected_version IS NOT NULL\n       AND v_current_version IS NOT NULL\n       AND p_expected_version <> v_current_version THEN\n        RETURN jsonb_build_object(\n            'status', 'ERROR',\n            'code', 'VERSION_CONFLICT',\n            'message', 'Profile completion version mismatch.',\n            'expected_version', p_expected_version,\n            'current_version', v_current_version\n        )
\n    END IF
\n\n    -- Merge the patch onto the existing profile values to evaluate completion.\n    SELECT to_jsonb(p) || p_patch\n      INTO v_merged\n      FROM public.profiles p\n     WHERE p.user_id = v_parsed_user_id\n     LIMIT 1
\n\n    v_full_name         := v_merged->>'full_name'
\n    v_organization      := v_merged->>'organization'
\n    v_position          := v_merged->>'position'
\n    v_phone_verified_at := nullif(v_merged->>'phone_verified_at','')::timestamptz
\n\n    -- Check completion requirements on the merged state.\n    IF p_mark_complete THEN\n        IF v_full_name IS NULL OR btrim(v_full_name) = ''\n           OR v_organization IS NULL OR btrim(v_organization) = ''\n           OR v_position IS NULL OR btrim(v_position) = ''\n           OR v_phone_verified_at IS NULL\n        THEN\n            RETURN jsonb_build_object(\n                'status', 'ERROR',\n                'code', 'COMPLETION_REQUIREMENTS_NOT_MET',\n                'message', 'Completion requirements are not met.',\n                'missing', jsonb_build_object(\n                    'full_name', (v_full_name IS NULL OR btrim(v_full_name) = ''),\n                    'organization', (v_organization IS NULL OR btrim(v_organization) = ''),\n                    'position', (v_position IS NULL OR btrim(v_position) = ''),\n                    'phone_verified_at', (v_phone_verified_at IS NULL)\n                )\n            )
\n        END IF
\n    END IF
\n\n    -- Allow the completion guard to accept this function's writes.\n    PERFORM set_config('app.profile_completion_write', 'true', true)
\n\n    -- Build the dynamic SET clause from the allowed patch keys only.\n    v_set_clauses := concat_ws(', ',\n        CASE WHEN p_patch ? 'full_name'        THEN 'full_name = $1' END,\n        CASE WHEN p_patch ? 'organization'     THEN 'organization = $2' END,\n        CASE WHEN p_patch ? 'position'         THEN 'position = $3' END,\n        CASE WHEN p_patch ? 'department'       THEN 'department = $4' END,\n        CASE WHEN p_patch ? 'city'              THEN 'city = $5' END,\n        CASE WHEN p_patch ? 'location'          THEN 'location = $6' END,\n        CASE WHEN p_patch ? 'bio'               THEN 'bio = $7' END,\n        CASE WHEN p_patch ? 'website'            THEN 'website = $8' END,\n        CASE WHEN p_patch ? 'linkedin_url'       THEN 'linkedin_url = $9' END,\n        'profile_completion_status = $10',\n        'profile_completion_version = profile_completion_version + 1',\n        'updated_at = now()'\n    )
\n\n    -- Single UPDATE with EXECUTE format.\n    EXECUTE format(\n        'UPDATE public.profiles\n            SET %s\n          WHERE user_id = $11\n          RETURNING profile_completion_version',\n        v_set_clauses\n    )\n    USING\n        p_patch->>'full_name',\n        p_patch->>'organization',\n        p_patch->>'position',\n        p_patch->>'department',\n        p_patch->>'city',\n        p_patch->>'location',\n        p_patch->>'bio',\n        p_patch->>'website',\n        p_patch->>'linkedin_url',\n        CASE WHEN p_mark_complete THEN 'complete' ELSE 'in_progress' END,\n        v_parsed_user_id\n    INTO v_current_version
\n\n    GET DIAGNOSTICS v_rows_updated = ROW_COUNT
\n\n    -- Reset the completion GUC.\n    PERFORM set_config('app.profile_completion_write', 'false', true)
\n\n    IF v_rows_updated = 0 THEN\n        RETURN jsonb_build_object(\n            'status', 'ERROR',\n            'code', 'UPDATE_FAILED',\n            'message', 'No rows updated.'\n        )
\n    END IF
\n\n    RETURN jsonb_build_object(\n        'status', 'OK',\n        'profile_completion_version', v_current_version,\n        'profile_completion_status', CASE WHEN p_mark_complete THEN 'complete' ELSE 'in_progress' END\n    )
\n\nEXCEPTION\n    WHEN OTHERS THEN\n        PERFORM set_config('app.profile_completion_write', 'false', true)
\n        RAISE
\nEND
\n$function$
\n\nREVOKE EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) FROM PUBLIC, anon
\nGRANT EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) TO authenticated
