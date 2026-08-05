/*
# Phase 4 — Fix settings loading in on_auth_user_created_lifecycle_profile

## Summary
The previous version of `public.on_auth_user_created_lifecycle_profile()` loaded
security settings into an untyped `record` variable (`v_settings`) and then
accessed fields by name (`v_settings.registration_requires_admin_approval`).
When `SELECT ... INTO v_settings` uses `COALESCE(...)` expressions without
aliases, the record fields are named `coalesce` (not the underlying column
names), so the subsequent field access silently returns NULL — causing every
new user to get wrong lifecycle/completion status.

This migration rewrites only the settings-loading section to:
- Remove the `v_settings record` variable.
- Read directly into the two explicit boolean variables
  `v_requires_approval` and `v_require_completion` using `SELECT ... INTO`.
- Use table-qualified column names (`s.registration_requires_admin_approval`).
- Raise a safe exception if the settings row does not exist.

No other part of the trigger function is changed. The trigger on `auth.users`
is preserved.

## Safety
- No prior migration file is modified.
- No data is deleted, reset, truncated, or modified.
- No edge function is changed.
- No RLS policy is changed.
- No test file is changed.
*/

CREATE OR REPLACE FUNCTION public.on_auth_user_created_lifecycle_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_registration_flow       text;
  v_requires_approval       boolean := false;
  v_require_completion      boolean := false;

  -- Public registration metadata (from raw_app_meta_data)
  v_challenge_id            uuid;
  v_claim_id                uuid;
  v_identity_hash           text;

  -- Admin-created metadata (from raw_app_meta_data)
  v_provision_is_admin      boolean := false;
  v_provisioned_by          uuid;

  -- User metadata (from raw_user_meta_data)
  v_full_name               text;
  v_username                text;
  v_email                   text;
  v_phone                   text;
  v_first_name              text;
  v_last_name               text;
  v_organization            text;
  v_position                text;
  v_department              text;
  v_employee_id             text;
  v_birth_date              text;
  v_gender                  text;
  v_city                    text;
  v_location                text;
  v_bio                     text;
  v_website                  text;
  v_linkedin_url            text;
  v_national_id             text;

  -- Normalized values
  v_normalized_username     text;
  v_normalized_email        text;
  v_normalized_phone        text;

  -- Lifecycle values
  v_account_status          text;
  v_is_active               boolean;
  v_completion_status       text;
  v_is_admin                boolean := false;
  v_registration_source     text;
  v_changed_by              uuid;

  -- Challenge row
  v_challenge               record;
BEGIN
  v_registration_flow := NEW.raw_app_meta_data ->> 'registration_flow';

  -- Only proceed for known registration flows
  IF v_registration_flow IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_registration_flow NOT IN ('public_phone_v1', 'admin_created_v1') THEN
    RETURN NEW;
  END IF;

  -- Load security settings directly into explicit variables
  SELECT
    COALESCE(s.registration_requires_admin_approval, false),
    COALESCE(s.require_profile_completion, false)
  INTO
    v_requires_approval,
    v_require_completion
  FROM public.auth_security_settings AS s
  WHERE s.id = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth_security_settings row (id=1) not found; cannot provision user lifecycle'
    USING ERRCODE = 'check_violation';
  END IF;

  -- Extract common user metadata from raw_user_meta_data
  v_first_name   := NEW.raw_user_meta_data ->> 'first_name';
  v_last_name    := NEW.raw_user_meta_data ->> 'last_name';
  v_full_name    := NEW.raw_user_meta_data ->> 'full_name';
  v_username     := NEW.raw_user_meta_data ->> 'username';
  v_email        := NEW.raw_user_meta_data ->> 'email';
  v_phone        := NEW.raw_user_meta_data ->> 'phone';
  v_organization := NEW.raw_user_meta_data ->> 'organization';
  v_position     := NEW.raw_user_meta_data ->> 'position';
  v_department   := NEW.raw_user_meta_data ->> 'department';
  v_employee_id  := NEW.raw_user_meta_data ->> 'employee_id';
  v_birth_date   := NEW.raw_user_meta_data ->> 'birth_date';
  v_gender       := NEW.raw_user_meta_data ->> 'gender';
  v_city         := NEW.raw_user_meta_data ->> 'city';
  v_location     := NEW.raw_user_meta_data ->> 'location';
  v_bio          := NEW.raw_user_meta_data ->> 'bio';
  v_website      := NEW.raw_user_meta_data ->> 'website';
  v_linkedin_url := NEW.raw_user_meta_data ->> 'linkedin_url';
  v_national_id  := NEW.raw_user_meta_data ->> 'national_id';

  IF v_full_name IS NULL AND (v_first_name IS NOT NULL OR v_last_name IS NOT NULL) THEN
    v_full_name := trim(COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, ''));
  END IF;

  -- Normalize identifiers (matching sync_normalized_profile_fields logic)
  v_normalized_username := lower(trim(v_username));
  v_normalized_email    := lower(trim(v_email));
  v_normalized_phone    := public.normalize_iran_phone(v_phone);

  -- Set lifecycle GUCs transaction-local so guard_protected_profile_fields
  -- allows this function to write the protected lifecycle columns.
  PERFORM set_config('app.account_lifecycle_write', 'true', true);
  PERFORM set_config('app.profile_completion_write', 'true', true);

  IF v_registration_flow = 'public_phone_v1' THEN
    -- Read challenge metadata from raw_app_meta_data
    v_challenge_id  := nullif(trim(NEW.raw_app_meta_data ->> 'registration_challenge_id'), '')::uuid;
    v_claim_id      := nullif(trim(NEW.raw_app_meta_data ->> 'registration_claim_id'), '')::uuid;
    v_identity_hash := NEW.raw_app_meta_data ->> 'registration_identity_hash';

    -- Validate the challenge with FOR UPDATE
    SELECT *
    INTO v_challenge
    FROM public.public_registration_challenges
    WHERE id = v_challenge_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'registration challenge % not found', v_challenge_id
      USING ERRCODE = 'check_violation';
    END IF;

    IF v_challenge.status <> 'processing' THEN
      RAISE EXCEPTION 'registration challenge % not in processing state (status=%)',
        v_challenge_id, v_challenge.status
      USING ERRCODE = 'check_violation';
    END IF;

    IF v_challenge.processing_claim_id IS DISTINCT FROM v_claim_id THEN
      RAISE EXCEPTION 'registration challenge % claim mismatch', v_challenge_id
      USING ERRCODE = 'check_violation';
    END IF;

    IF v_challenge.identity_hash IS DISTINCT FROM v_identity_hash THEN
      RAISE EXCEPTION 'registration challenge % identity mismatch', v_challenge_id
      USING ERRCODE = 'check_violation';
    END IF;

    IF v_challenge.processing_expires_at <= now() THEN
      RAISE EXCEPTION 'registration challenge % processing expired', v_challenge_id
      USING ERRCODE = 'check_violation';
    END IF;

    IF v_challenge.created_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'registration challenge % already consumed', v_challenge_id
      USING ERRCODE = 'check_violation';
    END IF;

    -- Determine lifecycle status
    IF v_requires_approval THEN
      v_account_status := 'PENDING_ADMIN_APPROVAL';
      v_is_active := false;
    ELSE
      v_account_status := 'ACTIVE';
      v_is_active := true;
    END IF;

    IF v_require_completion THEN
      v_completion_status := 'IN_PROGRESS';
    ELSE
      v_completion_status := 'COMPLETE';
    END IF;

    v_registration_source := 'public_phone_registration';
    v_changed_by := NEW.id;
    v_is_admin := false;

    -- Atomic profile insert (no ON CONFLICT — surface as hard error)
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
      NEW.phone_confirmed_at,
      CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END,
      v_is_admin, false, false,
      false,
      1, 1,
      v_registration_source,
      now(), v_changed_by
    );

    -- Consume the challenge in the same transaction
    UPDATE public.public_registration_challenges
    SET status = 'consumed',
        created_user_id = NEW.id,
        consumed_at = now(),
        processing_claim_id = NULL,
        processing_started_at = NULL,
        processing_expires_at = NULL,
        updated_at = now()
    WHERE id = v_challenge_id
      AND status = 'processing';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'registration challenge % could not be consumed', v_challenge_id
      USING ERRCODE = 'check_violation';
    END IF;

    -- Audit: registration completed
    INSERT INTO public.security_audit_events (
      actor_user_id, target_user_id,
      event_type, event_category, severity, result,
      metadata
    ) VALUES (
      NEW.id, NEW.id,
      'registration_completed', 'auth', 'info', 'success',
      jsonb_build_object(
        'registration_source', v_registration_source,
        'phone_confirmed_at', NEW.phone_confirmed_at,
        'requires_admin_approval', v_requires_approval
      )
    );

    -- Audit: pending admin approval (only when required)
    IF v_requires_approval THEN
      INSERT INTO public.security_audit_events (
        actor_user_id, target_user_id,
        event_type, event_category, severity, result,
        metadata
      ) VALUES (
        NULL, NEW.id,
        'account_pending_admin_approval', 'auth', 'info', 'success',
        jsonb_build_object(
          'registration_source', v_registration_source,
          'requires_admin_approval', true
        )
      );
    END IF;

  ELSIF v_registration_flow = 'admin_created_v1' THEN
    -- Read admin provisioning metadata from raw_app_meta_data
    v_provision_is_admin := COALESCE(
      (NEW.raw_app_meta_data ->> 'provision_is_admin')::boolean, false);
    v_provisioned_by := nullif(
      trim(NEW.raw_app_meta_data ->> 'provisioned_by'), '')::uuid;

    v_account_status      := 'ACTIVE';
    v_is_active            := true;
    v_completion_status    := 'COMPLETE';
    v_registration_source  := 'admin_created';
    v_changed_by           := v_provisioned_by;
    v_is_admin             := v_provision_is_admin;

    -- Atomic profile insert (no ON CONFLICT — surface as hard error)
    INSERT INTO public.profiles (
      user_id, full_name, username, email, phone,
      normalized_username, normalized_email, normalized_phone,
      organization, position, department, employee_id,
      birth_date, gender, city, location, bio, website, linkedin_url,
      national_id,
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
      v_organization, v_position, v_department, v_employee_id,
      nullif(v_birth_date, '')::date, v_gender, v_city, v_location, v_bio, v_website, v_linkedin_url,
      v_national_id,
      v_account_status, v_is_active,
      v_completion_status,
      NEW.phone_confirmed_at,
      CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END,
      v_is_admin, false, false,
      false,
      1, 1,
      v_registration_source,
      now(), v_changed_by
    );

    -- Audit: registration completed
    INSERT INTO public.security_audit_events (
      actor_user_id, target_user_id,
      event_type, event_category, severity, result,
      metadata
    ) VALUES (
      v_provisioned_by, NEW.id,
      'registration_completed', 'auth', 'info', 'success',
      jsonb_build_object(
        'registration_source', v_registration_source,
        'provision_is_admin', v_provision_is_admin,
        'provisioned_by', v_provisioned_by
      )
    );

    -- Audit: pending admin approval (only when required)
    IF v_requires_approval THEN
      INSERT INTO public.security_audit_events (
        actor_user_id, target_user_id,
        event_type, event_category, severity, result,
        metadata
      ) VALUES (
        v_provisioned_by, NEW.id,
        'account_pending_admin_approval', 'auth', 'info', 'success',
        jsonb_build_object(
          'registration_source', v_registration_source,
          'provisioned_by', v_provisioned_by,
          'provision_is_admin', v_provision_is_admin
        )
      );
    END IF;
  END IF;

  -- Reset GUCs
  PERFORM set_config('app.account_lifecycle_write', 'false', true);
  PERFORM set_config('app.profile_completion_write', 'false', true);

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    -- Reset GUCs so no state leaks if we bail mid-function.
    PERFORM set_config('app.account_lifecycle_write', 'false', true);
    PERFORM set_config('app.profile_completion_write', 'false', true);
    RAISE;
END;
$function$;

ALTER FUNCTION public.on_auth_user_created_lifecycle_profile() OWNER TO postgres;
