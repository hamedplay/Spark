/*
# Phase 3B Hardening — Security Console Read Model

Replaces public.get_auth_security_console_state() with hardened version:
- Independent session validation (auth.uid, session_id, auth.sessions, not_after)
- Impact counts only for active profiles (is_active=true, account_status='ACTIVE')
- users_with_verified_totp: active profiles with EXISTS verified TOTP
- users_without_verified_totp: active profiles with NOT EXISTS verified TOTP
- No subtraction of counts from different populations

Safety:
- No prior migration modified
- No data deleted/reset/truncated
- No MFA policy changed
- No experimental factors created
*/

CREATE OR REPLACE FUNCTION public.get_auth_security_console_state()
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
  v_settings jsonb;
  v_active_users int;
  v_users_with_verified_totp int;
  v_users_without_verified_totp int;
  v_security_admins int;
  v_security_admins_without_verified_totp int;
  v_recent_history jsonb;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
BEGIN
  -- 1. Must be authenticated
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- 2. Extract session_id from JWT
  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  -- 3. Verify session exists and belongs to user
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions
    WHERE id = v_session_id AND user_id = v_uid
  ) INTO v_session_exists;

  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  -- 4. Check not_after expiry
  SELECT not_after INTO v_session_not_after
  FROM auth.sessions WHERE id = v_session_id LIMIT 1;

  IF v_session_not_after IS NOT NULL AND v_session_not_after <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  -- 5. Must be an active security admin
  IF NOT public.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  -- 6. Load current settings (single row, id=1)
  SELECT to_jsonb(s) - 'updated_by' INTO v_settings
  FROM public.auth_security_settings s
  WHERE s.id = 1;

  IF v_settings IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  -- 7. Impact: active users
  SELECT count(DISTINCT p.user_id) INTO v_active_users
  FROM public.profiles p
  WHERE p.is_active IS TRUE
    AND p.account_status = 'ACTIVE';

  -- 8. Users with verified TOTP (active only, EXISTS)
  SELECT count(DISTINCT p.user_id) INTO v_users_with_verified_totp
  FROM public.profiles p
  WHERE p.is_active IS TRUE
    AND p.account_status = 'ACTIVE'
    AND EXISTS (
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = p.user_id
        AND f.factor_type = 'totp'
        AND f.status = 'verified'
    );

  -- 9. Users without verified TOTP (active only, NOT EXISTS — not subtraction)
  SELECT count(DISTINCT p.user_id) INTO v_users_without_verified_totp
  FROM public.profiles p
  WHERE p.is_active IS TRUE
    AND p.account_status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = p.user_id
        AND f.factor_type = 'totp'
        AND f.status = 'verified'
    );

  -- 10. Security admins count
  SELECT count(DISTINCT p.user_id) INTO v_security_admins
  FROM public.profiles p
  WHERE p.is_security_admin IS TRUE
    AND p.is_active IS TRUE
    AND p.account_status = 'ACTIVE';

  -- 11. Security admins without verified TOTP
  SELECT count(DISTINCT p.user_id) INTO v_security_admins_without_verified_totp
  FROM public.profiles p
  WHERE p.is_security_admin IS TRUE
    AND p.is_active IS TRUE
    AND p.account_status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = p.user_id
        AND f.factor_type = 'totp'
        AND f.status = 'verified'
    );

  -- 12. Recent history (max 20)
  SELECT jsonb_agg(jsonb_build_object(
    'version', h.version,
    'changed_at', h.changed_at,
    'change_reason', h.change_reason,
    'changed_by', h.changed_by,
    'mfa_policy', h.mfa_policy,
    'allow_totp_mfa', h.allow_totp_mfa,
    'username_login', h.username_login,
    'email_login', h.email_login,
    'phone_login', h.phone_login
  ) ORDER BY h.changed_at DESC) INTO v_recent_history
  FROM (
    SELECT *
    FROM public.auth_security_settings_history
    ORDER BY changed_at DESC
    LIMIT 20
  ) h;

  IF v_recent_history IS NULL THEN
    v_recent_history := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', v_settings,
    'impact', jsonb_build_object(
      'active_users', v_active_users,
      'users_with_verified_totp', v_users_with_verified_totp,
      'users_without_verified_totp', v_users_without_verified_totp,
      'security_admins', v_security_admins,
      'security_admins_without_verified_totp', v_security_admins_without_verified_totp
    ),
    'recent_history', v_recent_history
  );
END;
$function$;

-- ACL
REVOKE EXECUTE ON FUNCTION public.get_auth_security_console_state() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_auth_security_console_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_auth_security_console_state() TO authenticated;

ALTER FUNCTION public.get_auth_security_console_state() OWNER TO postgres;
