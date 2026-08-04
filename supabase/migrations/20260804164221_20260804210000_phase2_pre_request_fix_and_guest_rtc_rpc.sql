/*
# Phase 2 — Pre-request fix (no evaluator exposure) + Guest RTC Config RPC

## 1. Pre-request fix

The previous pre-request function called `private.evaluate_current_auth_access()`
internally, but `authenticated` lacks EXECUTE on that evaluator, causing a
permission error when PostgREST invokes the pre-request hook.

This migration redefines the pre-request to use only
`private.is_current_session_fully_authorized()` — a SECURITY DEFINER boolean
helper that authenticated can execute.

Flow:
  1. Bypass for postgres / service_role / supabase_admin
  2. Bypass for true anonymous (auth.uid() IS NULL)
  3. Normalize path
  4. Allowlist: rpc/get_my_auth_access_state, rpc/get_public_auth_config, rpc/get_public_login_methods
  5. For all other paths: call is_current_session_fully_authorized(); reject with SQLSTATE 42501 if false

ACL:
  - Pre-request: EXECUTE for anon, authenticated, service_role
  - Evaluator (evaluate_current_auth_access): still only postgres
  - Boolean helper (is_current_session_fully_authorized): authenticated + service_role + postgres

## 2. Guest RTC Config RPC

New function `public.get_public_conference_runtime_config()`:
  - SECURITY DEFINER, STABLE, search_path=''
  - Executable by anon and authenticated
  - Returns only WebRTC runtime keys from system_config section='video_conference'
  - No admin settings, no secrets, no unrelated config

## Safety
  - Additive only; no previous migration edited
  - No data deleted, reset, or truncated
*/

-- ── 1. Redefine pre-request to use boolean helper only ──────────────────────

DROP FUNCTION IF EXISTS private.enforce_auth_access_pre_request();

CREATE OR REPLACE FUNCTION private.enforce_auth_access_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_path text;
  v_uid uuid;
BEGIN
  -- 1. Bypass for privileged internal roles
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN;
  END IF;

  -- 2. True anonymous (no JWT / anon key only)
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- 3. Normalize path
  v_path := lower(trim(leading '/' from current_setting('request.path', true)));

  -- 4. Allowlist: access-state and public-config RPCs always pass
  IF v_path IN (
    'rpc/get_my_auth_access_state',
    'rpc/get_public_auth_config',
    'rpc/get_public_login_methods'
  ) THEN
    RETURN;
  END IF;

  -- 5. All other paths require FULL authorization
  IF NOT private.is_current_session_fully_authorized() THEN
    RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ACL for pre-request
REVOKE EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() TO anon;
GRANT EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() TO authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() TO service_role;

-- Ensure the boolean helper is executable by authenticated (it is SECURITY DEFINER)
REVOKE EXECUTE ON FUNCTION private.is_current_session_fully_authorized() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_current_session_fully_authorized() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_current_session_fully_authorized() TO service_role;

-- Ensure the evaluator remains postgres-only
REVOKE EXECUTE ON FUNCTION private.evaluate_current_auth_access() FROM anon;
REVOKE EXECUTE ON FUNCTION private.evaluate_current_auth_access() FROM authenticated;

-- Re-affirm the pre-request hook
ALTER ROLE authenticator SET pgrst.db_pre_request = 'private.enforce_auth_access_pre_request';

-- ── 2. Guest RTC Config RPC ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_public_conference_runtime_config()
RETURNS TABLE (
  key text,
  value text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT c.key, c.value
  FROM public.system_config c
  WHERE c.section = 'video_conference'
    AND c.key IN (
      'turn_server',
      'turn_username',
      'turn_credential',
      'stun_servers',
      'ice_transport_policy',
      'enable_turn_fallback'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_conference_runtime_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_conference_runtime_config() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_conference_runtime_config() TO authenticated;

-- ── 3. Reload PostgREST ────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
