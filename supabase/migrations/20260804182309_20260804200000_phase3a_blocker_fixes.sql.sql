/*
# Phase 3A Blocker Fixes

## 1. Lock down write_mfa_stepup_denied_audit

Revoke EXECUTE from authenticated (was incorrectly granted in prior migration).
Only service_role may call it. The function is only invoked internally by
issue_totp_stepup_grant (SECURITY DEFINER, same owner).

## 2. Replace issue_totp_stepup_grant with hardened version

- Uses is_current_security_admin() helper instead of parallel logic
- Rejects PHONE_UNVERIFIED, PENDING_ADMIN_APPROVAL, REJECTED, SUSPENDED, LOCKED
- Validates p_purpose before storing in audit (no raw invalid purpose in audit)
- Uses COALESCE(p_request_id, gen_random_uuid()) for request_id
- Rejects future TOTP timestamps
- Preserves: advisory lock, consume-not-delete, insert one grant, session-bound

## Safety

- No prior migration is modified
- No data is deleted, reset, truncated, or cascaded
- No MFA policy or setting is changed
- No experimental factors created
*/

-- ── 1. Lock down audit helper ──────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) TO service_role;

ALTER FUNCTION public.write_mfa_stepup_denied_audit(uuid, uuid, text, text, uuid) OWNER TO postgres;

-- ── 2. Replace issue_totp_stepup_grant with hardened version ────────────────
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
  v_account_status text;
  v_has_verified_totp boolean := false;
  v_totp_proof_time timestamptz;
  v_request_id uuid;
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

  -- 3. Request ID: use provided or generate
  v_request_id := COALESCE(p_request_id, gen_random_uuid());

  -- 4. Session must exist and belong to the same user
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'SESSION_INVALID', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  -- 5. Session must not be expired
  SELECT not_after, COALESCE(aal::text, '') INTO v_session_not_after, v_session_aal
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= clock_timestamp() THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'SESSION_INVALID', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  -- 6. JWT must have aal = aal2
  v_jwt_aal := v_jwt ->> 'aal';
  IF COALESCE(v_jwt_aal, '') <> 'aal2' THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'AAL2_NOT_REACHED', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'AAL2_NOT_REACHED');
  END IF;

  -- 7. Session record must be compatible with AAL2
  IF COALESCE(v_session_aal, '') <> 'aal2' THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'AAL2_NOT_REACHED', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'AAL2_NOT_REACHED');
  END IF;

  -- 8. Validate purpose BEFORE any audit or further processing
  IF p_purpose IS NULL
     OR p_purpose NOT IN (
       'auth_settings_change',
       'account_security_change'
     )
  THEN
    -- Do NOT store raw invalid purpose in audit; use NULL
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'PURPOSE_NOT_ALLOWED', NULL, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'PURPOSE_NOT_ALLOWED');
  END IF;

  -- 9. Check account status — reject all non-ACTIVE statuses explicitly
  SELECT account_status INTO v_account_status
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND OR v_account_status IS NULL THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'AUTH_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF v_account_status IN ('PHONE_UNVERIFIED', 'PENDING_ADMIN_APPROVAL', 'REJECTED', 'SUSPENDED', 'LOCKED') THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'SECURITY_ADMIN_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  IF v_account_status <> 'ACTIVE' THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'SECURITY_ADMIN_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  -- 10. Must be an active security admin via helper
  IF NOT public.is_current_security_admin() THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'SECURITY_ADMIN_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  -- 11. User must have at least one verified TOTP factor
  SELECT EXISTS(
    SELECT 1 FROM auth.mfa_factors
    WHERE user_id = v_uid AND factor_type = 'totp' AND status = 'verified'
  ) INTO v_has_verified_totp;

  IF NOT v_has_verified_totp THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'RECENT_TOTP_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'RECENT_TOTP_REQUIRED');
  END IF;

  -- 12. Fresh TOTP proof (≤5 minutes, not in future) for this exact session
  SELECT greatest(created_at, updated_at) INTO v_totp_proof_time
  FROM auth.mfa_amr_claims
  WHERE session_id = v_session_id
    AND authentication_method = 'totp'
  ORDER BY greatest(created_at, updated_at) DESC
  LIMIT 1;

  IF v_totp_proof_time IS NULL
     OR v_totp_proof_time > clock_timestamp()
     OR v_totp_proof_time < clock_timestamp() - interval '5 minutes'
  THEN
    PERFORM public.write_mfa_stepup_denied_audit(v_uid, v_session_id, 'RECENT_TOTP_REQUIRED', p_purpose, v_request_id);
    RETURN jsonb_build_object('ok', false, 'error', 'RECENT_TOTP_REQUIRED');
  END IF;

  -- 13. Advisory transaction lock on (user, session, purpose)
  PERFORM pg_advisory_xact_lock(
    hashtextextended('mfa_stepup:' || v_uid::text || ':' || v_session_id::text || ':' || p_purpose, 0)
  );

  -- 14. Void previous unconsumed grants (set consumed_at, do NOT delete)
  UPDATE public.session_security_grants
  SET consumed_at = clock_timestamp()
  WHERE user_id = v_uid
    AND session_id = v_session_id
    AND purpose = p_purpose
    AND consumed_at IS NULL;

  -- 15. Compute metadata_hash (non-sensitive)
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

-- ── ACL: Revoke from PUBLIC/anon, grant only to authenticated ────────────────
REVOKE EXECUTE ON FUNCTION public.issue_totp_stepup_grant(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.issue_totp_stepup_grant(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_totp_stepup_grant(text, uuid) TO authenticated;

ALTER FUNCTION public.issue_totp_stepup_grant(text, uuid) OWNER TO postgres;
