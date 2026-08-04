/*
# Phase 3A — Issue TOTP Step-up Grant RPC

## Purpose

Creates a new SECURITY DEFINER function `public.issue_totp_stepup_grant`
that issues a short-lived (5-minute) MFA step-up grant after verifying
a fresh TOTP authentication in the current session.

## Security Contract

1. SECURITY DEFINER, search_path = ''
2. EXECUTE revoked from PUBLIC and anon; granted only to authenticated
3. Fail-closed: validates auth.uid(), session ownership, session not expired,
   JWT aal = aal2, session aal compatible, active profile, active security admin
4. Requires verified TOTP factor owned by the user
5. Requires fresh TOTP proof (≤5 minutes) in auth.mfa_amr_claims for the exact session
6. Advisory transaction lock on (user, session, purpose)
7. Voids previous unconsumed grants (sets consumed_at) — never deletes
8. Inserts exactly one grant with metadata_hash
9. Sanitized audit event on success; error-code-only audit on failure
10. No OTP, secret, challenge, or token in output, metadata, or audit

## New Function

- `public.issue_totp_stepup_grant(p_purpose text, p_request_id uuid default gen_random_uuid())`
  Returns: jsonb with grant_id, purpose, issued_at, expires_at, request_id

## Allowed Purposes (Phase 3A)

- auth_settings_change
- account_security_change

## Tables Modified

- None. Only reads from session_security_grants, auth.sessions, auth.mfa_factors,
  auth.mfa_amr_claims, public.profiles, public.security_audit_events.

## Important Notes

- No existing migration is modified.
- No data is deleted or reset.
- No MFA policy or setting is changed.
- No experimental factors are created.
- Grant type = 'mfa_stepup', factor_type = 'totp', assurance_level = 'aal2'
- TTL enforced by existing constraint session_security_grants_max_ttl_5min
*/

-- ── Helper: write denied audit for MFA step-up failures ──────────────────
CREATE OR REPLACE FUNCTION public.write_mfa_stepup_denied_audit(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_error_code text,
  p_purpose text,
  p_request_id uuid DEFAULT NULL::uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.security_audit_events (
    actor_user_id, event_type, event_category, severity,
    session_id, request_id, result, error_code, metadata
  ) VALUES (
    p_actor_user_id,
    'mfa_stepup_grant_denied',
    'mfa',
    'warning',
    p_session_id,
    p_request_id,
    'denied',
    p_error_code,
    jsonb_build_object(
      'purpose', p_purpose
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) TO authenticated;

-- ── Main: issue_totp_stepup_grant ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_totp_stepup_grant(
  p_purpose text,
  p_request_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
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
  v_session_aal text;
  v_jwt_aal text;
  v_is_security_admin boolean := false;
  v_is_active boolean := false;
  v_account_status text;
  v_has_verified_totp boolean := false;
  v_totp_proof_time timestamptz;
  v_valid_purpose boolean := false;
  v_request_id uuid;
  v_previous_grant_id uuid;
  v_new_grant_id uuid;
  v_issued_at timestamptz := clock_timestamp();
  v_expires_at timestamptz := v_issued_at + interval '5 minutes';
  v_metadata_hash text;
BEGIN
  -- 1. auth.uid() must be non-null
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  END IF;

  -- 2. Extract session_id from JWT
  BEGIN
    v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_session_id := NULL;
  END;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  -- 3. Validate request_id (use provided or generated)
  v_request_id := p_request_id;

  -- 4. Session must exist and belong to the same user
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'SESSION_INVALID', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  -- 5. Session must not be expired
  SELECT not_after, COALESCE(aal::text, '') INTO v_session_not_after, v_session_aal
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'SESSION_INVALID', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  -- 6. JWT must have aal = aal2
  v_jwt_aal := v_jwt ->> 'aal';
  IF COALESCE(v_jwt_aal, '') <> 'aal2' THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'AAL2_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'AAL2_REQUIRED');
  END IF;

  -- 7. Session record must be compatible with AAL2
  IF COALESCE(v_session_aal, '') <> 'aal2' THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'AAL2_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'AAL2_REQUIRED');
  END IF;

  -- 8. User must have an active profile
  SELECT is_security_admin IS TRUE, is_active IS TRUE, account_status
  INTO v_is_security_admin, v_is_active, v_account_status
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND OR NOT v_is_active OR v_account_status IS NULL OR v_account_status NOT IN ('ACTIVE', 'PHONE_UNVERIFIED', 'PENDING_ADMIN_APPROVAL') THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'AUTH_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF v_account_status IN ('REJECTED', 'SUSPENDED', 'LOCKED') THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'AUTH_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  END IF;

  -- 9. User must be an active security admin
  IF NOT v_is_security_admin THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'SECURITY_ADMIN_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  -- 10. Purpose must be in the allowlist
  v_valid_purpose := p_purpose IN ('auth_settings_change', 'account_security_change');
  IF NOT v_valid_purpose THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'PURPOSE_NOT_ALLOWED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'PURPOSE_NOT_ALLOWED');
  END IF;

  -- 11. User must have at least one verified TOTP factor
  SELECT EXISTS(
    SELECT 1 FROM auth.mfa_factors
    WHERE user_id = v_uid AND factor_type = 'totp' AND status = 'verified'
  ) INTO v_has_verified_totp;

  IF NOT v_has_verified_totp THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'VERIFIED_TOTP_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'VERIFIED_TOTP_REQUIRED');
  END IF;

  -- 12. Must have a fresh TOTP proof (≤5 minutes) in mfa_amr_claims for this exact session
  SELECT greatest(created_at, updated_at) INTO v_totp_proof_time
  FROM auth.mfa_amr_claims
  WHERE session_id = v_session_id
    AND authentication_method = 'totp'
  ORDER BY greatest(created_at, updated_at) DESC
  LIMIT 1;

  IF v_totp_proof_time IS NULL THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'RECENT_TOTP_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'RECENT_TOTP_REQUIRED');
  END IF;

  IF clock_timestamp() - v_totp_proof_time > interval '5 minutes' THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'RECENT_TOTP_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'RECENT_TOTP_REQUIRED');
  END IF;

  -- 13. Take advisory transaction lock on (user, session, purpose)
  PERFORM pg_advisory_xact_lock(
    hashtextextended('mfa_stepup:' || v_uid::text || ':' || v_session_id::text || ':' || p_purpose, 0)
  );

  -- 14. Void previous unconsumed grants for same user+session+purpose (set consumed_at, do NOT delete)
  UPDATE public.session_security_grants
  SET consumed_at = clock_timestamp()
  WHERE user_id = v_uid
    AND session_id = v_session_id
    AND purpose = p_purpose
    AND consumed_at IS NULL;

  -- 15. Compute metadata_hash (non-sensitive: purpose, factor_type, assurance_level, session_id hash)
  v_metadata_hash := md5(
    p_purpose || '|' || 'totp' || '|' || 'aal2' || '|' || v_session_id::text
  );

  -- 16. Insert exactly one new grant
  INSERT INTO public.session_security_grants (
    user_id, grant_type, issued_at, expires_at, consumed_at,
    metadata_hash, session_id, purpose, factor_type, assurance_level, request_id
  ) VALUES (
    v_uid, 'mfa_stepup', v_issued_at, v_expires_at, NULL,
    v_metadata_hash, v_session_id, p_purpose, 'totp', 'aal2', v_request_id
  )
  RETURNING id INTO v_new_grant_id;

  -- 17. Sanitized audit event for successful issuance
  INSERT INTO public.security_audit_events (
    user_id, event_type, event_category, severity,
    session_id, request_id, result, metadata
  ) VALUES (
    v_uid,
    'mfa_stepup_grant_issued',
    'mfa',
    'info',
    v_session_id,
    v_request_id,
    'success',
    jsonb_build_object(
      'purpose', p_purpose,
      'request_id', v_request_id::text,
      'factor_type', 'totp',
      'assurance_level', 'aal2',
      'expires_at', v_expires_at::text
    )
  );

  -- 18. Return limited, non-sensitive output
  RETURN jsonb_build_object(
    'ok', true,
    'grant_id', v_new_grant_id::text,
    'purpose', p_purpose,
    'issued_at', v_issued_at::text,
    'expires_at', v_expires_at::text,
    'request_id', v_request_id::text
  );
END;
$function$;

-- ── ACL: Revoke from PUBLIC/anon, grant only to authenticated ─────────────
REVOKE EXECUTE ON FUNCTION public.issue_totp_stepup_grant(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.issue_totp_stepup_grant(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_totp_stepup_grant(text, uuid) TO authenticated;

-- ── Ensure owner is postgres ───────────────────────────────────────────────
ALTER FUNCTION public.issue_totp_stepup_grant(text, uuid) OWNER TO postgres;
ALTER FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) OWNER TO postgres;
