/*
# Phase 6 — Custom MFA access gate and privilege hardening

## Purpose
Connects session-bound Custom MFA grants to the existing full-access gate and removes direct browser access to sensitive MFA tables and internal functions.

## Security changes
1. Custom MFA required settings now return RESTRICTED/MFA_REQUIRED until an unexpired grant matches both auth.uid() and the JWT session_id.
2. Custom MFA never changes Supabase AAL or creates aal2 claims.
3. Browser roles cannot insert/update MFA factors, challenges, grants, recovery hashes, or Bale nonces.
4. Recovery hashes and encrypted identifiers are not directly selectable by browser roles.
5. Internal grant/encryption/HMAC functions are not remotely executable.

## Data safety
No rows are deleted, reset, truncated, or modified by this migration.
*/

REVOKE ALL ON TABLE public.custom_mfa_factors FROM anon, authenticated;
REVOKE ALL ON TABLE public.custom_mfa_challenges FROM anon, authenticated;
REVOKE ALL ON TABLE public.custom_mfa_grants FROM anon, authenticated;
REVOKE ALL ON TABLE public.custom_mfa_recovery_codes FROM anon, authenticated;
REVOKE ALL ON TABLE public.bale_link_nonces FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.issue_custom_mfa_grant(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_active_custom_mfa_grant(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hmac_with_pepper(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mfa_encrypt(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mfa_decrypt(bytea) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_custom_mfa_challenge(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_bale_link_nonce(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_custom_mfa_challenge(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_bale_link_nonce(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_custom_mfa_grant(uuid, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_active_custom_mfa_grant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hmac_with_pepper(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mfa_encrypt(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mfa_decrypt(bytea) TO service_role;

CREATE OR REPLACE FUNCTION private.evaluate_current_auth_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
  v_session_aal text;
  v_session_created_at timestamptz;
  v_profile record;
  v_settings record;
  v_has_verified_totp boolean := false;
  v_jwt_aal text;
  v_mfa_required boolean := false;
  v_custom_mfa_required boolean := false;
  v_custom_mfa_granted boolean := false;
  v_gateway_enabled boolean := false;
  v_gateway_enforced_after timestamptz;
  v_is_password_session boolean := false;
  v_gateway_authorized boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('has_session', false, 'access_level', 'BLOCKED', 'reason_code', 'SESSION_REQUIRED', 'next_step', 'login', 'user_id', null, 'session_id', null, 'account_status', null, 'profile_completion_status', null, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', null);
  END IF;

  BEGIN
    v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_session_id := NULL;
  END;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('has_session', false, 'access_level', 'BLOCKED', 'reason_code', 'SESSION_REQUIRED', 'next_step', 'login', 'user_id', v_uid::text, 'session_id', null, 'account_status', null, 'profile_completion_status', null, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', null);
  END IF;

  SELECT EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid) INTO v_session_exists;
  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('has_session', false, 'access_level', 'BLOCKED', 'reason_code', 'SESSION_INVALID', 'next_step', 'login', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', null, 'profile_completion_status', null, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', null);
  END IF;

  SELECT not_after, COALESCE(aal::text, ''), created_at INTO v_session_not_after, v_session_aal, v_session_created_at FROM auth.sessions WHERE id = v_session_id LIMIT 1;
  IF v_session_not_after IS NOT NULL AND v_session_not_after <= now() THEN
    RETURN jsonb_build_object('has_session', false, 'access_level', 'BLOCKED', 'reason_code', 'SESSION_EXPIRED', 'next_step', 'login', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', null, 'profile_completion_status', null, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal);
  END IF;

  SELECT enabled, enforced_after INTO v_gateway_enabled, v_gateway_enforced_after FROM private.password_gateway_enforcement WHERE id = true LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_jwt -> 'amr', '[]'::jsonb)) AS item WHERE item ->> 'method' = 'password') INTO v_is_password_session;
  IF v_gateway_enabled = true AND v_gateway_enforced_after IS NOT NULL AND v_session_created_at >= v_gateway_enforced_after AND v_is_password_session = true THEN
    SELECT EXISTS (SELECT 1 FROM private.password_gateway_session_authorizations WHERE session_id = v_session_id AND user_id = v_uid) INTO v_gateway_authorized;
    IF NOT v_gateway_authorized THEN
      RETURN jsonb_build_object('has_session', true, 'access_level', 'BLOCKED', 'reason_code', 'PASSWORD_GATEWAY_REQUIRED', 'next_step', 'login', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', null, 'profile_completion_status', null, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal);
    END IF;
  END IF;

  SELECT account_status, profile_completion_status, is_active, mfa_enrollment_required INTO v_profile FROM public.profiles WHERE user_id = v_uid LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('has_session', true, 'access_level', 'BLOCKED', 'reason_code', 'PROFILE_MISSING', 'next_step', 'login', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', null, 'profile_completion_status', null, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal);
  END IF;

  IF v_profile.account_status IS NULL OR v_profile.account_status NOT IN ('ACTIVE', 'PHONE_UNVERIFIED', 'PENDING_ADMIN_APPROVAL', 'REJECTED', 'SUSPENDED', 'LOCKED') THEN
    RETURN jsonb_build_object('has_session', true, 'access_level', 'BLOCKED', 'reason_code', 'ACCOUNT_STATUS_INVALID', 'next_step', null, 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal);
  END IF;
  IF v_profile.account_status IN ('REJECTED', 'SUSPENDED', 'LOCKED') THEN
    RETURN jsonb_build_object('has_session', true, 'access_level', 'BLOCKED', 'reason_code', 'ACCOUNT_' || upper(v_profile.account_status), 'next_step', null, 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal);
  END IF;
  IF v_profile.account_status = 'PHONE_UNVERIFIED' THEN
    RETURN jsonb_build_object('has_session', true, 'access_level', 'RESTRICTED', 'reason_code', 'PHONE_VERIFICATION_REQUIRED', 'next_step', 'verify_phone', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal);
  END IF;
  IF v_profile.account_status = 'PENDING_ADMIN_APPROVAL' THEN
    RETURN jsonb_build_object('has_session', true, 'access_level', 'RESTRICTED', 'reason_code', 'ADMIN_APPROVAL_REQUIRED', 'next_step', 'wait_approval', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal);
  END IF;
  IF v_profile.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('has_session', true, 'access_level', 'BLOCKED', 'reason_code', 'ACCOUNT_SUSPENDED', 'next_step', null, 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal);
  END IF;

  SELECT require_profile_completion, mfa_policy, custom_mfa_enabled, custom_mfa_required INTO v_settings FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  IF COALESCE(v_settings.require_profile_completion, false) = true AND v_profile.profile_completion_status <> 'COMPLETE' THEN
    RETURN jsonb_build_object('has_session', true, 'access_level', 'RESTRICTED', 'reason_code', 'PROFILE_COMPLETION_REQUIRED', 'next_step', 'complete_profile', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal);
  END IF;

  v_jwt_aal := v_jwt ->> 'aal';
  SELECT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = v_uid AND factor_type = 'totp' AND status = 'verified') INTO v_has_verified_totp;
  IF COALESCE(v_settings.mfa_policy, 'disabled') = 'required' OR v_profile.mfa_enrollment_required = true THEN
    v_mfa_required := true;
  END IF;

  IF v_mfa_required THEN
    IF NOT v_has_verified_totp THEN
      RETURN jsonb_build_object('has_session', true, 'access_level', 'RESTRICTED', 'reason_code', 'MFA_ENROLLMENT_REQUIRED', 'next_step', 'enroll_mfa', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', true, 'has_verified_totp', false, 'current_aal', v_session_aal);
    END IF;
    IF COALESCE(v_session_aal, '') <> 'aal2' OR COALESCE(v_jwt_aal, '') <> 'aal2' THEN
      RETURN jsonb_build_object('has_session', true, 'access_level', 'RESTRICTED', 'reason_code', 'MFA_CHALLENGE_REQUIRED', 'next_step', 'verify_mfa', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', true, 'has_verified_totp', true, 'current_aal', v_session_aal);
    END IF;
  END IF;

  v_custom_mfa_required := COALESCE(v_settings.custom_mfa_enabled, false) AND COALESCE(v_settings.custom_mfa_required, false);
  IF v_custom_mfa_required THEN
    SELECT public.has_active_custom_mfa_grant(v_uid, v_session_id) INTO v_custom_mfa_granted;
    IF NOT v_custom_mfa_granted THEN
      RETURN jsonb_build_object('has_session', true, 'access_level', 'RESTRICTED', 'reason_code', 'MFA_REQUIRED', 'next_step', 'verify_custom_mfa', 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', true, 'has_verified_totp', v_has_verified_totp, 'current_aal', v_session_aal);
    END IF;
  END IF;

  RETURN jsonb_build_object('has_session', true, 'access_level', 'FULL', 'reason_code', 'AUTHORIZED', 'next_step', null, 'user_id', v_uid::text, 'session_id', v_session_id::text, 'account_status', v_profile.account_status, 'profile_completion_status', v_profile.profile_completion_status, 'mfa_required', v_mfa_required OR v_custom_mfa_required, 'has_verified_totp', v_has_verified_totp, 'current_aal', v_session_aal);
END;
$function$;
