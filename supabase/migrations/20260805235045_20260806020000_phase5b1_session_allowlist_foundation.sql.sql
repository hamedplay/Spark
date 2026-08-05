-- Phase 5B-1: Session Allowlist Foundation
-- 1. Gateway session authorizations table (stores only hashes)
CREATE TABLE private.password_gateway_session_authorizations (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  login_method text NOT NULL CHECK (
    login_method IN (
      'username',
      'email',
      'phone',
      'public_registration'
    )
  ),
  identifier_hash text NOT NULL CHECK (length(identifier_hash) = 64),
  ip_hash text NOT NULL CHECK (length(ip_hash) = 64),
  auth_session_created_at timestamptz NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX password_gateway_session_user_idx
ON private.password_gateway_session_authorizations (
  user_id,
  authorized_at DESC
);

REVOKE ALL
ON private.password_gateway_session_authorizations
FROM PUBLIC, anon, authenticated, service_role;

-- 2. Enforcement config table (single row, disabled by default)
CREATE TABLE private.password_gateway_enforcement (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT false,
  enforced_after timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO private.password_gateway_enforcement (id, enabled, enforced_after)
VALUES (true, false, NULL);

REVOKE ALL
ON private.password_gateway_enforcement
FROM PUBLIC, anon, authenticated, service_role;

-- 3. RPC to authorize a gateway session
CREATE OR REPLACE FUNCTION public.authorize_password_gateway_session_v1(
  p_session_id uuid,
  p_user_id uuid,
  p_login_method text,
  p_identifier_hash text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session_created_at timestamptz;
  v_session_not_after timestamptz;
  v_existing_method text;
  v_settings_row public.auth_security_settings%ROWTYPE;
  v_method_enabled boolean := false;
BEGIN
  -- Validate all parameters non-null
  IF p_session_id IS NULL OR p_user_id IS NULL OR p_login_method IS NULL
     OR p_identifier_hash IS NULL OR p_ip_hash IS NULL THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- Validate login method
  IF p_login_method NOT IN ('username', 'email', 'phone', 'public_registration') THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- Validate hashes are exactly 64 lowercase hex chars
  IF NOT regexp_match(p_identifier_hash, '^[0-9a-f]{64}$') IS NOT NULL THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;
  IF NOT regexp_match(p_ip_hash, '^[0-9a-f]{64}$') IS NOT NULL THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- Verify session exists in auth.sessions with matching user_id
  BEGIN
    SELECT created_at, not_after INTO v_session_created_at, v_session_not_after
    FROM auth.sessions
    WHERE id = p_session_id AND user_id = p_user_id
    LIMIT 1;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('authorized', false);
  END;

  IF NOT FOUND OR v_session_created_at IS NULL THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- Session must not be expired
  IF v_session_not_after IS NOT NULL AND v_session_not_after <= now() THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  -- For password login methods, verify method was enabled at session creation time
  IF p_login_method IN ('username', 'email', 'phone') THEN
    SELECT * INTO v_settings_row
    FROM public.auth_security_settings
    WHERE id = 1
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('authorized', false);
    END IF;

    v_method_enabled := CASE p_login_method
      WHEN 'username' THEN COALESCE(v_settings_row.username_login, false)
      WHEN 'email' THEN COALESCE(v_settings_row.email_login, false)
      WHEN 'phone' THEN COALESCE(v_settings_row.phone_login, false)
    END;

    IF NOT v_method_enabled THEN
      RETURN jsonb_build_object('authorized', false);
    END IF;
  END IF;
  -- public_registration does not depend on password login method settings

  -- Idempotency: check if same session_id already exists
  SELECT login_method INTO v_existing_method
  FROM private.password_gateway_session_authorizations
  WHERE session_id = p_session_id
  LIMIT 1;

  IF FOUND THEN
    -- If user_id or method differs, reject
    IF v_existing_method <> p_login_method THEN
      RETURN jsonb_build_object('authorized', false);
    END IF;
    -- Verify user_id also matches by checking the full row
    PERFORM 1
    FROM private.password_gateway_session_authorizations
    WHERE session_id = p_session_id AND user_id = p_user_id AND login_method = p_login_method
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('authorized', false);
    END IF;
    -- Idempotent success
    RETURN jsonb_build_object('authorized', true, 'session_id', p_session_id);
  END IF;

  -- Insert new authorization
  INSERT INTO private.password_gateway_session_authorizations (
    session_id, user_id, login_method, identifier_hash, ip_hash, auth_session_created_at
  )
  VALUES (
    p_session_id, p_user_id, p_login_method, p_identifier_hash, p_ip_hash, v_session_created_at
  )
  ON CONFLICT (session_id) DO NOTHING;

  IF NOT FOUND THEN
    -- Conflict: another concurrent insert with different user/method
    RETURN jsonb_build_object('authorized', false);
  END IF;

  RETURN jsonb_build_object('authorized', true, 'session_id', p_session_id);
END;
$function$;

ALTER FUNCTION public.authorize_password_gateway_session_v1(
  uuid, uuid, text, text, text
) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION
public.authorize_password_gateway_session_v1(
  uuid, uuid, text, text, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.authorize_password_gateway_session_v1(
  uuid, uuid, text, text, text
)
TO service_role;

-- 4. Update central gate: evaluate_current_auth_access
-- Preserve ALL existing behavior; add gateway allowlist check (disabled by default)
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
v_gateway_enabled boolean := false;
v_gateway_enforced_after timestamptz;
v_is_password_session boolean := false;
v_gateway_authorized boolean := false;
BEGIN
IF v_uid IS NULL THEN
RETURN jsonb_build_object(
'has_session', false, 'access_level', 'BLOCKED',
'reason_code', 'SESSION_REQUIRED', 'next_step', 'login',
'user_id', null, 'session_id', null,
'account_status', null, 'profile_completion_status', null,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', null
);
END IF;

BEGIN
v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
EXCEPTION WHEN others THEN
v_session_id := NULL;
END;

IF v_session_id IS NULL THEN
RETURN jsonb_build_object(
'has_session', false, 'access_level', 'BLOCKED',
'reason_code', 'SESSION_REQUIRED', 'next_step', 'login',
'user_id', v_uid::text, 'session_id', null,
'account_status', null, 'profile_completion_status', null,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', null
);
END IF;

SELECT EXISTS(
SELECT 1 FROM auth.sessions
WHERE id = v_session_id AND user_id = v_uid
) INTO v_session_exists;

IF NOT v_session_exists THEN
RETURN jsonb_build_object(
'has_session', false, 'access_level', 'BLOCKED',
'reason_code', 'SESSION_INVALID', 'next_step', 'login',
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', null, 'profile_completion_status', null,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', null
);
END IF;

SELECT not_after, COALESCE(aal::text, ''), created_at
INTO v_session_not_after, v_session_aal, v_session_created_at
FROM auth.sessions WHERE id = v_session_id LIMIT 1;

IF v_session_not_after IS NOT NULL AND v_session_not_after <= now() THEN
RETURN jsonb_build_object(
'has_session', false, 'access_level', 'BLOCKED',
'reason_code', 'SESSION_EXPIRED', 'next_step', 'login',
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', null, 'profile_completion_status', null,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal
);
END IF;

-- Gateway allowlist check (disabled by default; only active when enabled=true)
SELECT enabled, enforced_after
INTO v_gateway_enabled, v_gateway_enforced_after
FROM private.password_gateway_enforcement
WHERE id = true
LIMIT 1;

SELECT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(
    COALESCE(v_jwt -> 'amr', '[]'::jsonb)
  ) AS item
  WHERE item ->> 'method' = 'password'
)
INTO v_is_password_session;

IF v_gateway_enabled = true
   AND v_gateway_enforced_after IS NOT NULL
   AND v_session_created_at >= v_gateway_enforced_after
   AND v_is_password_session = true THEN

  SELECT EXISTS (
    SELECT 1
    FROM private.password_gateway_session_authorizations
    WHERE session_id = v_session_id AND user_id = v_uid
  ) INTO v_gateway_authorized;

  IF NOT v_gateway_authorized THEN
    RETURN jsonb_build_object(
    'has_session', true, 'access_level', 'BLOCKED',
    'reason_code', 'PASSWORD_GATEWAY_REQUIRED', 'next_step', 'login',
    'user_id', v_uid::text, 'session_id', v_session_id::text,
    'account_status', null, 'profile_completion_status', null,
    'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal
    );
  END IF;
END IF;

SELECT account_status, profile_completion_status, is_active, mfa_enrollment_required
INTO v_profile
FROM public.profiles WHERE user_id = v_uid LIMIT 1;

IF NOT FOUND THEN
RETURN jsonb_build_object(
'has_session', true, 'access_level', 'BLOCKED',
'reason_code', 'PROFILE_MISSING', 'next_step', 'login',
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', null, 'profile_completion_status', null,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal
);
END IF;

IF v_profile.account_status IS NULL OR v_profile.account_status NOT IN (
'ACTIVE', 'PHONE_UNVERIFIED', 'PENDING_ADMIN_APPROVAL',
'REJECTED', 'SUSPENDED', 'LOCKED'
) THEN
RETURN jsonb_build_object(
'has_session', true, 'access_level', 'BLOCKED',
'reason_code', 'ACCOUNT_STATUS_INVALID', 'next_step', null,
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', v_profile.account_status,
'profile_completion_status', v_profile.profile_completion_status,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal
);
END IF;

IF v_profile.account_status IN ('REJECTED', 'SUSPENDED', 'LOCKED') THEN
RETURN jsonb_build_object(
'has_session', true, 'access_level', 'BLOCKED',
'reason_code', 'ACCOUNT_' || upper(v_profile.account_status),
'next_step', null,
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', v_profile.account_status,
'profile_completion_status', v_profile.profile_completion_status,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal
);
END IF;

IF v_profile.account_status = 'PHONE_UNVERIFIED' THEN
RETURN jsonb_build_object(
'has_session', true, 'access_level', 'RESTRICTED',
'reason_code', 'PHONE_VERIFICATION_REQUIRED', 'next_step', 'verify_phone',
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', v_profile.account_status,
'profile_completion_status', v_profile.profile_completion_status,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal
);
END IF;

IF v_profile.account_status = 'PENDING_ADMIN_APPROVAL' THEN
RETURN jsonb_build_object(
'has_session', true, 'access_level', 'RESTRICTED',
'reason_code', 'ADMIN_APPROVAL_REQUIRED', 'next_step', 'wait_approval',
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', v_profile.account_status,
'profile_completion_status', v_profile.profile_completion_status,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal
);
END IF;

IF v_profile.is_active IS NOT TRUE THEN
RETURN jsonb_build_object(
'has_session', true, 'access_level', 'BLOCKED',
'reason_code', 'ACCOUNT_SUSPENDED', 'next_step', null,
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', v_profile.account_status,
'profile_completion_status', v_profile.profile_completion_status,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal
);
END IF;

SELECT require_profile_completion, mfa_policy
INTO v_settings
FROM public.auth_security_settings WHERE id = 1 LIMIT 1;

IF COALESCE(v_settings.require_profile_completion, false) = true
AND v_profile.profile_completion_status <> 'COMPLETE' THEN
RETURN jsonb_build_object(
'has_session', true, 'access_level', 'RESTRICTED',
'reason_code', 'PROFILE_COMPLETION_REQUIRED', 'next_step', 'complete_profile',
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', v_profile.account_status,
'profile_completion_status', v_profile.profile_completion_status,
'mfa_required', false, 'has_verified_totp', false, 'current_aal', v_session_aal
);
END IF;

v_jwt_aal := v_jwt ->> 'aal';

SELECT EXISTS(
SELECT 1 FROM auth.mfa_factors
WHERE user_id = v_uid AND factor_type = 'totp' AND status = 'verified'
) INTO v_has_verified_totp;

IF COALESCE(v_settings.mfa_policy, 'disabled') = 'required' THEN
v_mfa_required := true;
ELSIF v_profile.mfa_enrollment_required = true THEN
v_mfa_required := true;
END IF;

IF v_mfa_required THEN
IF NOT v_has_verified_totp THEN
RETURN jsonb_build_object(
'has_session', true, 'access_level', 'RESTRICTED',
'reason_code', 'MFA_ENROLLMENT_REQUIRED', 'next_step', 'enroll_mfa',
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', v_profile.account_status,
'profile_completion_status', v_profile.profile_completion_status,
'mfa_required', true, 'has_verified_totp', false, 'current_aal', v_session_aal
);
END IF;

IF COALESCE(v_session_aal, '') <> 'aal2' OR COALESCE(v_jwt_aal, '') <> 'aal2' THEN
RETURN jsonb_build_object(
'has_session', true, 'access_level', 'RESTRICTED',
'reason_code', 'MFA_CHALLENGE_REQUIRED', 'next_step', 'verify_mfa',
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', v_profile.account_status,
'profile_completion_status', v_profile.profile_completion_status,
'mfa_required', true, 'has_verified_totp', true, 'current_aal', v_session_aal
);
END IF;
END IF;

RETURN jsonb_build_object(
'has_session', true, 'access_level', 'FULL',
'reason_code', 'AUTHORIZED', 'next_step', null,
'user_id', v_uid::text, 'session_id', v_session_id::text,
'account_status', v_profile.account_status,
'profile_completion_status', v_profile.profile_completion_status,
'mfa_required', v_mfa_required, 'has_verified_totp', v_has_verified_totp,
'current_aal', v_session_aal
);
END;
$function$;

ALTER FUNCTION private.evaluate_current_auth_access() OWNER TO postgres;
