/*
# Phase 2 Blocker Fixes: Pre-request INVOKER, system_config split, storage split
# Additive only — no prior migration edited, no data deleted.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PostgREST Pre-request: SECURITY INVOKER + proper grants + NOTIFY
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old SECURITY DEFINER version
DROP FUNCTION IF EXISTS private.enforce_auth_access_pre_request();

-- Recreate as SECURITY INVOKER so current_user reflects the actual request role
CREATE OR REPLACE FUNCTION private.enforce_auth_access_pre_request()
RETURNS void
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid uuid;
  v_result jsonb;
  v_access_level text;
  v_path text;
  v_normalized_path text;
  v_allowed_paths text[] := ARRAY[
    'rpc/get_my_auth_access_state',
    'rpc/get_public_auth_config',
    'rpc/get_public_login_methods'
  ];
BEGIN
  -- Bypass: service_role and postgres (invoker role is already these)
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN;
  END IF;

  -- Get auth.uid() — NULL means anonymous request, bypass
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- Evaluate access for authenticated user
  v_result := private.evaluate_current_auth_access();
  v_access_level := v_result ->> 'access_level';

  IF v_access_level = 'FULL' THEN
    RETURN;
  END IF;

  -- Restricted or Blocked: check allowlist
  v_path := current_setting('request.path', true);
  v_normalized_path := lower(trim(leading '/' from split_part(v_path, '?', 1)));

  IF v_normalized_path = ANY(v_allowed_paths) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE = '42501';
END;
$$;

-- Pre-request must be executable by anon, authenticated, and service_role
REVOKE EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() TO anon;
GRANT EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() TO authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() TO service_role;

-- Grant USAGE on private schema only to roles that need it for the pre-request
-- anon and authenticated need USAGE to call the pre-request function
-- service_role already has it via superuser-like privileges
GRANT USAGE ON SCHEMA private TO anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- But REVOKE EXECUTE on all OTHER private functions from anon and authenticated
-- so they cannot call internal functions directly
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'private'
      AND p.proname <> 'enforce_auth_access_pre_request'
      AND p.proname <> 'is_current_session_fully_authorized'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ORDER BY p.proname
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.oid::regprocedure::text);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.oid::regprocedure::text);
  END LOOP;
END $$;

-- Re-register pre-request and force PostgREST reload
ALTER ROLE authenticator SET pgrst.db_pre_request = 'private.enforce_auth_access_pre_request';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. system_config: split FOR ALL into 4 separate restrictive policies
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the existing FOR ALL gate on system_config
DROP POLICY IF EXISTS auth_global_full_access_gate ON public.system_config;

-- SELECT: Full session OR public sections (general, appearance)
CREATE POLICY auth_gate_system_config_select ON public.system_config
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT private.is_current_session_fully_authorized())
    OR section IN ('general', 'appearance')
  );

-- INSERT: only Full session
CREATE POLICY auth_gate_system_config_insert ON public.system_config
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_current_session_fully_authorized())
  );

-- UPDATE: only Full session
CREATE POLICY auth_gate_system_config_update ON public.system_config
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    (SELECT private.is_current_session_fully_authorized())
  )
  WITH CHECK (
    (SELECT private.is_current_session_fully_authorized())
  );

-- DELETE: only Full session
CREATE POLICY auth_gate_system_config_delete ON public.system_config
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT private.is_current_session_fully_authorized())
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Storage: split FOR ALL write gate into separate INSERT/UPDATE/DELETE
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the FOR ALL write gate
DROP POLICY IF EXISTS auth_global_storage_write_gate ON storage.objects;

-- SELECT: Full session OR public bucket (keep existing)
-- (auth_global_storage_read_gate already exists from prior migration, keep it)

-- INSERT: only Full session
CREATE POLICY auth_gate_storage_insert ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_current_session_fully_authorized())
  );

-- UPDATE: only Full session
CREATE POLICY auth_gate_storage_update ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    (SELECT private.is_current_session_fully_authorized())
  )
  WITH CHECK (
    (SELECT private.is_current_session_fully_authorized())
  );

-- DELETE: only Full session
CREATE POLICY auth_gate_storage_delete ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT private.is_current_session_fully_authorized())
  );

NOTIFY pgrst, 'reload schema';
