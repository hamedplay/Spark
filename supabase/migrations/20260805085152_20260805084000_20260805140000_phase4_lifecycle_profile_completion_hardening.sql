-- ============================================================================
-- Migration: 20260805084000_20260805140000_phase4_lifecycle_profile_completion_hardening
-- Phase 4: Account lifecycle + profile completion hardening
--
-- This migration hardens the account lifecycle and profile completion flows:
--   1. on_auth_user_created_lifecycle_profile()
--        Trigger fired on auth.users INSERT. Consumes the phone-verification
--        challenge in the same transaction, seeds the profile row with fields
--        provisioned by an admin (when applicable), records audit events for
--        registration_completed and account_pending_admin_approval, and sets
--        the GUCs that the guard function below requires.
--   2. guard_protected_profile_fields()
--        BEFORE INSERT/UPDATE trigger function on public.profiles that blocks
--        writes to lifecycle/completion/role fields unless the appropriate GUC
--        is set by a SECURITY DEFINER function, and blocks role fields
--        unconditionally.
--   3. get_my_profile_completion_state()
--        RPC returning the caller's profile-completion state. Validates the
--        session and account status before returning anything.
--   4. save_my_profile_completion(p_patch, p_expected_version, p_mark_complete)
--        RPC accepting a JSON patch + optimistic version. Validates session,
--        account status, patch shape, and completion requirements before
--        performing a single UPDATE.
-- ============================================================================

-- ============================================================================
-- 1. on_auth_user_created_lifecycle_profile()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.on_auth_user_created_lifecycle_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_settings             record;


    v_challenge_id         uuid;


    v_claim_id             uuid;


    v_raw_phone            text;


    v_normalized_phone     text;


    v_is_admin_created     boolean := false;


    v_provision_is_admin   boolean := false;


    v_provisioned_by       uuid;


    v_requires_approval    boolean := false;


    v_require_completion   boolean := false;


BEGIN
    -- Load the single-row security settings configuration.
    SELECT *
      INTO v_settings
      FROM public.auth_security_settings s
     WHERE s.id = 1;



    IF v_settings IS NULL THEN
        RAISE EXCEPTION 'auth_security_settings row not found (id=1)';


    END IF;



    v_requires_approval  := COALESCE(v_settings.registration_requires_admin_approval, false);


    v_require_completion := COALESCE(v_settings.require_profile_completion, false);



    -- Only proceed when the user confirmed their phone during signup.
    IF NEW.phone_confirmed_at IS NOT NULL THEN
        -- Resolve the pending challenge id / claim id from raw metadata.
        v_challenge_id := nullif(trim(NEW.raw_user_meta_data->>'challenge_id'), '')::uuid;


        v_claim_id     := nullif(trim(NEW.raw_user_meta_data->>'claim_id'), '')::uuid;


        v_raw_phone    := NEW.raw_user_meta_data->>'phone';


        v_normalized_phone := NEW.raw_user_meta_data->>'normalized_phone';



        -- Detect admin-provisioned signup.
        v_is_admin_created := (NEW.raw_app_meta_data->>'registration_source') = 'admin_created_v1';



        IF v_is_admin_created THEN
            v_provision_is_admin := COALESCE(
                (NEW.raw_app_meta_data->>'provision_is_admin')::boolean, false);


            v_provisioned_by := nullif(
                trim(NEW.raw_app_meta_data->>'provisioned_by'), '')::uuid;


        END IF;



        -- Allow the lifecycle + completion guard to accept this function's writes.
        PERFORM set_config('app.account_lifecycle_write', 'true', true);


        PERFORM set_config('app.profile_completion_write', 'true', true);



        -- Seed the profile row. We intentionally do NOT use ON CONFLICT here:
        -- the trigger runs exactly once per new auth user, so the row must not
        -- already exist. A duplicate would surface as a hard error.
        IF v_is_admin_created THEN
            INSERT INTO public.profiles (
                user_id,
                account_status,
                is_active,
                account_lifecycle_version,
                account_status_changed_at,
                account_status_changed_by,
                registration_source,
                phone_verified_at,
                phone,
                normalized_phone,
                organization,
                position,
                department,
                employee_id,
                birth_date,
                gender,
                city,
                location,
                bio,
                website,
                linkedin_url,
                national_id,
                is_admin,
                is_security_admin,
                security_role_version
            )
            VALUES (
                NEW.id,
                CASE WHEN v_requires_approval THEN 'pending_approval' ELSE 'active' END,
                CASE WHEN v_requires_approval THEN false ELSE true END,
                1,
                now(),
                v_provisioned_by,
                'admin_created_v1',
                NEW.phone_confirmed_at,
                v_raw_phone,
                v_normalized_phone,
                NEW.raw_user_meta_data->>'organization',
                NEW.raw_user_meta_data->>'position',
                NEW.raw_user_meta_data->>'department',
                NEW.raw_user_meta_data->>'employee_id',
                nullif(NEW.raw_user_meta_data->>'birth_date','')::date,
                NEW.raw_user_meta_data->>'gender',
                NEW.raw_user_meta_data->>'city',
                NEW.raw_user_meta_data->>'location',
                NEW.raw_user_meta_data->>'bio',
                NEW.raw_user_meta_data->>'website',
                NEW.raw_user_meta_data->>'linkedin_url',
                NEW.raw_user_meta_data->>'national_id',
                false,
                false,
                1
            );


        ELSE
            INSERT INTO public.profiles (
                user_id,
                account_status,
                is_active,
                account_lifecycle_version,
                account_status_changed_at,
                account_status_changed_by,
                registration_source,
                phone_verified_at,
                phone,
                normalized_phone,
                is_admin,
                is_security_admin,
                security_role_version
            )
            VALUES (
                NEW.id,
                CASE WHEN v_requires_approval THEN 'pending_approval' ELSE 'active' END,
                CASE WHEN v_requires_approval THEN false ELSE true END,
                1,
                now(),
                NEW.id,
                'self_signup_v1',
                NEW.phone_confirmed_at,
                v_raw_phone,
                v_normalized_phone,
                false,
                false,
                1
            );


        END IF;



        -- Consume the challenge atomically in the same transaction. The claim
        -- must still be processing, not expired, and not yet bound to a user.
        UPDATE public.challenges
           SET status = 'consumed',
               created_user_id = NEW.id
         WHERE id = v_challenge_id
           AND status = 'processing'
           AND processing_claim_id = v_claim_id
           AND processing_expires_at > now()
           AND created_user_id IS NULL;



        IF NOT FOUND THEN
            RAISE EXCEPTION
                'challenge % could not be consumed (expired, already consumed, or not in processing state)',
                v_challenge_id
                USING ERRCODE = 'check_violation';


        END IF;



        -- Audit: registration completed.
        INSERT INTO public.audit_events (
            actor_id, event_type, target_id, metadata, created_at
        )
        VALUES (
            NEW.id,
            'registration_completed',
            NEW.id,
            jsonb_build_object(
                'registration_source', NEW.raw_app_meta_data->>'registration_source',
                'phone_confirmed_at', NEW.phone_confirmed_at,
                'requires_admin_approval', v_requires_approval
            ),
            now()
        );



        -- Audit: pending admin approval (only when the setting requires it).
        IF v_requires_approval THEN
            INSERT INTO public.audit_events (
                actor_id, event_type, target_id, metadata, created_at
            )
            VALUES (
                v_provisioned_by,
                'account_pending_admin_approval',
                NEW.id,
                jsonb_build_object(
                    'registration_source', NEW.raw_app_meta_data->>'registration_source',
                    'provisioned_by', v_provisioned_by,
                    'provision_is_admin', v_provision_is_admin
                ),
                now()
            );


        END IF;


    END IF;



    RETURN NEW;



EXCEPTION
    WHEN OTHERS THEN
        -- Reset the GUCs so no state leaks if we bail mid-function.
        PERFORM set_config('app.account_lifecycle_write', 'false', true);


        PERFORM set_config('app.profile_completion_write', 'false', true);


        RAISE;


END;


$function$;



-- ============================================================================
-- 2. guard_protected_profile_fields()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.guard_protected_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_lifecycle_write     text;


    v_completion_write    text;


    v_is_self             boolean := false;


BEGIN
    v_lifecycle_write  := current_setting('app.account_lifecycle_write', true);


    v_completion_write := current_setting('app.profile_completion_write', true);



    -- Determine whether the caller is the owner of this profile row.
    v_is_self := (auth.uid() = NEW.user_id);



    -- --------------------------------------------------------------------
    -- Lifecycle fields: only writable when the lifecycle GUC is set.
    -- --------------------------------------------------------------------
    IF v_lifecycle_write IS DISTINCT FROM 'true' THEN
        IF TG_OP = 'UPDATE' THEN
            IF NEW.account_status              IS DISTINCT FROM OLD.account_status
               OR NEW.is_active                IS DISTINCT FROM OLD.is_active
               OR NEW.account_lifecycle_version IS DISTINCT FROM OLD.account_lifecycle_version
               OR NEW.account_status_changed_at IS DISTINCT FROM OLD.account_status_changed_at
               OR NEW.account_status_changed_by IS DISTINCT FROM OLD.account_status_changed_by
               OR NEW.registration_source       IS DISTINCT FROM OLD.registration_source
               OR NEW.phone_verified_at         IS DISTINCT FROM OLD.phone_verified_at
            THEN
                RAISE EXCEPTION 'direct write to protected lifecycle fields is not permitted'
                    USING ERRCODE = 'check_violation';


            END IF;


        ELSE
            IF NEW.account_status IS NOT NULL
               OR NEW.is_active IS NOT NULL
               OR NEW.account_lifecycle_version IS NOT NULL
               OR NEW.account_status_changed_at IS NOT NULL
               OR NEW.account_status_changed_by IS NOT NULL
               OR NEW.registration_source IS NOT NULL
               OR NEW.phone_verified_at IS NOT NULL
            THEN
                RAISE EXCEPTION 'direct write to protected lifecycle fields is not permitted'
                    USING ERRCODE = 'check_violation';


            END IF;


        END IF;


    END IF;



    -- --------------------------------------------------------------------
    -- Completion fields: writable only with the completion GUC AND self.
    -- --------------------------------------------------------------------
    IF NOT (v_completion_write = 'true' AND v_is_self) THEN
        IF TG_OP = 'UPDATE' THEN
            IF NEW.profile_completion_status   IS DISTINCT FROM OLD.profile_completion_status
               OR NEW.profile_completion_version IS DISTINCT FROM OLD.profile_completion_version
            THEN
                RAISE EXCEPTION 'direct write to protected completion fields is not permitted'
                    USING ERRCODE = 'check_violation';


            END IF;


        ELSE
            IF NEW.profile_completion_status IS NOT NULL
               OR NEW.profile_completion_version IS NOT NULL
            THEN
                RAISE EXCEPTION 'direct write to protected completion fields is not permitted'
                    USING ERRCODE = 'check_violation';


            END IF;


        END IF;


    END IF;



    -- --------------------------------------------------------------------
    -- Role / normalized identity fields: never writable from client context,
    -- even when the lifecycle or completion GUC is set.
    -- --------------------------------------------------------------------
    IF TG_OP = 'UPDATE' THEN
        IF NEW.is_admin              IS DISTINCT FROM OLD.is_admin
           OR NEW.is_security_admin  IS DISTINCT FROM OLD.is_security_admin
           OR NEW.security_role_version IS DISTINCT FROM OLD.security_role_version
           OR NEW.normalized_username IS DISTINCT FROM OLD.normalized_username
           OR NEW.normalized_email    IS DISTINCT FROM OLD.normalized_email
           OR NEW.normalized_phone    IS DISTINCT FROM OLD.normalized_phone
        THEN
            RAISE EXCEPTION 'direct write to role / normalized identity fields is not permitted'
                USING ERRCODE = 'check_violation';


        END IF;


    ELSE
        IF NEW.is_admin IS NOT NULL
           OR NEW.is_security_admin IS NOT NULL
           OR NEW.security_role_version IS NOT NULL
           OR NEW.normalized_username IS NOT NULL
           OR NEW.normalized_email IS NOT NULL
           OR NEW.normalized_phone IS NOT NULL
        THEN
            RAISE EXCEPTION 'direct write to role / normalized identity fields is not permitted'
                USING ERRCODE = 'check_violation';


        END IF;


    END IF;



    RETURN NEW;


END;


$function$;



ALTER FUNCTION public.guard_protected_profile_fields() OWNER TO postgres;



-- ============================================================================
-- 3. get_my_profile_completion_state()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_profile_completion_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_session_user_id  uuid;


    v_parsed_user_id   uuid;


    v_is_active        boolean;


    v_result           jsonb;


BEGIN
    -- Session validation with exception-safe UUID parsing.
    BEGIN
        v_session_user_id := auth.uid();


        v_parsed_user_id  := v_session_user_id::uuid;


    EXCEPTION
        WHEN invalid_text_representation OR others THEN
            RETURN jsonb_build_object(
                'status', 'ERROR',
                'code', 'SESSION_INVALID',
                'message', 'No valid session.'
            );


    END;



    IF v_parsed_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'SESSION_INVALID',
            'message', 'No valid session.'
        );


    END IF;



    -- Account status gate.
    SELECT p.is_active
      INTO v_is_active
      FROM public.profiles p
     WHERE p.user_id = v_parsed_user_id
     LIMIT 1;



    IF v_is_active IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'ACCOUNT_NOT_ACTIVE',
            'message', 'Account is not active.'
        );


    END IF;



    -- Return the completion state payload.
    SELECT jsonb_build_object(
        'status', 'OK',
        'user_id', p.user_id,
        'profile_completion_status', p.profile_completion_status,
        'profile_completion_version', p.profile_completion_version,
        'fields', jsonb_build_object(
            'full_name', p.full_name,
            'organization', p.organization,
            'position', p.position,
            'phone_verified_at', p.phone_verified_at
        )
    )
      INTO v_result
      FROM public.profiles p
     WHERE p.user_id = v_parsed_user_id
     LIMIT 1;



    RETURN COALESCE(v_result, jsonb_build_object(
        'status', 'ERROR',
        'code', 'PROFILE_NOT_FOUND',
        'message', 'Profile row not found.'
    ));


END;


$function$;



REVOKE EXECUTE ON FUNCTION public.get_my_profile_completion_state() FROM PUBLIC, anon;


GRANT EXECUTE ON FUNCTION public.get_my_profile_completion_state() TO authenticated;



-- ============================================================================
-- 4. save_my_profile_completion(p_patch, p_expected_version, p_mark_complete)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_my_profile_completion(
    p_patch            jsonb,
    p_expected_version bigint,
    p_mark_complete    boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_session_user_id   uuid;


    v_parsed_user_id    uuid;


    v_is_active         boolean;


    v_current_version   bigint;


    v_merged            jsonb;


    v_set_clauses       text;


    v_full_name         text;


    v_organization      text;


    v_position          text;


    v_phone_verified_at timestamptz;


    v_rows_updated      bigint;


BEGIN
    -- Session validation with exception-safe UUID parsing.
    BEGIN
        v_session_user_id := auth.uid();


        v_parsed_user_id  := v_session_user_id::uuid;


    EXCEPTION
        WHEN invalid_text_representation OR others THEN
            RETURN jsonb_build_object(
                'status', 'ERROR',
                'code', 'SESSION_INVALID',
                'message', 'No valid session.'
            );


    END;



    IF v_parsed_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'SESSION_INVALID',
            'message', 'No valid session.'
        );


    END IF;



    -- Validate the patch is a JSON object.
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'INVALID_PATCH',
            'message', 'Patch must be a JSON object.'
        );


    END IF;



    -- Account status gate + row lock.
    SELECT p.is_active, p.profile_completion_version
      INTO v_is_active, v_current_version
      FROM public.profiles p
     WHERE p.user_id = v_parsed_user_id
     FOR UPDATE;



    IF v_is_active IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'ACCOUNT_NOT_ACTIVE',
            'message', 'Account is not active.'
        );


    END IF;



    -- Optimistic concurrency check.
    IF p_expected_version IS NOT NULL
       AND v_current_version IS NOT NULL
       AND p_expected_version <> v_current_version THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'VERSION_CONFLICT',
            'message', 'Profile completion version mismatch.',
            'expected_version', p_expected_version,
            'current_version', v_current_version
        );


    END IF;



    -- Merge the patch onto the existing profile values to evaluate completion.
    SELECT to_jsonb(p) || p_patch
      INTO v_merged
      FROM public.profiles p
     WHERE p.user_id = v_parsed_user_id
     LIMIT 1;



    v_full_name         := v_merged->>'full_name';


    v_organization      := v_merged->>'organization';


    v_position          := v_merged->>'position';


    v_phone_verified_at := nullif(v_merged->>'phone_verified_at','')::timestamptz;



    -- Check completion requirements on the merged state.
    IF p_mark_complete THEN
        IF v_full_name IS NULL OR btrim(v_full_name) = ''
           OR v_organization IS NULL OR btrim(v_organization) = ''
           OR v_position IS NULL OR btrim(v_position) = ''
           OR v_phone_verified_at IS NULL
        THEN
            RETURN jsonb_build_object(
                'status', 'ERROR',
                'code', 'COMPLETION_REQUIREMENTS_NOT_MET',
                'message', 'Completion requirements are not met.',
                'missing', jsonb_build_object(
                    'full_name', (v_full_name IS NULL OR btrim(v_full_name) = ''),
                    'organization', (v_organization IS NULL OR btrim(v_organization) = ''),
                    'position', (v_position IS NULL OR btrim(v_position) = ''),
                    'phone_verified_at', (v_phone_verified_at IS NULL)
                )
            );


        END IF;


    END IF;



    -- Allow the completion guard to accept this function's writes.
    PERFORM set_config('app.profile_completion_write', 'true', true);



    -- Build the dynamic SET clause from the allowed patch keys only.
    v_set_clauses := concat_ws(', ',
        CASE WHEN p_patch ? 'full_name'        THEN 'full_name = $1' END,
        CASE WHEN p_patch ? 'organization'     THEN 'organization = $2' END,
        CASE WHEN p_patch ? 'position'         THEN 'position = $3' END,
        CASE WHEN p_patch ? 'department'       THEN 'department = $4' END,
        CASE WHEN p_patch ? 'city'              THEN 'city = $5' END,
        CASE WHEN p_patch ? 'location'          THEN 'location = $6' END,
        CASE WHEN p_patch ? 'bio'               THEN 'bio = $7' END,
        CASE WHEN p_patch ? 'website'            THEN 'website = $8' END,
        CASE WHEN p_patch ? 'linkedin_url'       THEN 'linkedin_url = $9' END,
        'profile_completion_status = $10',
        'profile_completion_version = profile_completion_version + 1',
        'updated_at = now()'
    );



    -- Single UPDATE with EXECUTE format.
    EXECUTE format(
        'UPDATE public.profiles
            SET %s
          WHERE user_id = $11
          RETURNING profile_completion_version',
        v_set_clauses
    )
    USING
        p_patch->>'full_name',
        p_patch->>'organization',
        p_patch->>'position',
        p_patch->>'department',
        p_patch->>'city',
        p_patch->>'location',
        p_patch->>'bio',
        p_patch->>'website',
        p_patch->>'linkedin_url',
        CASE WHEN p_mark_complete THEN 'complete' ELSE 'in_progress' END,
        v_parsed_user_id
    INTO v_current_version;



    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;



    -- Reset the completion GUC.
    PERFORM set_config('app.profile_completion_write', 'false', true);



    IF v_rows_updated = 0 THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'UPDATE_FAILED',
            'message', 'No rows updated.'
        );


    END IF;



    RETURN jsonb_build_object(
        'status', 'OK',
        'profile_completion_version', v_current_version,
        'profile_completion_status', CASE WHEN p_mark_complete THEN 'complete' ELSE 'in_progress' END
    );



EXCEPTION
    WHEN OTHERS THEN
        PERFORM set_config('app.profile_completion_write', 'false', true);


        RAISE;


END;


$function$;



REVOKE EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) FROM PUBLIC, anon;


GRANT EXECUTE ON FUNCTION public.save_my_profile_completion(jsonb, bigint, boolean) TO authenticated;

;
