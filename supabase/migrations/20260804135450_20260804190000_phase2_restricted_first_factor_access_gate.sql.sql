/*
# Phase 2: Restricted First-Factor Session + Global Backend/RLS Access Gate
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Canonical Access Evaluator
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.evaluate_current_auth_access()
RETURNS jsonb
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_session_exists boolean := false;
  v_session_not_after timestamptz;
  v_session_aal text;
  v_profile record;
  v_settings record;
  v_has_verified_totp boolean := false;
  v_jwt_aal text;
  v_mfa_required boolean := false;
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

  SELECT not_after, COALESCE(aal::text, '') INTO v_session_not_after, v_session_aal
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
$$;

REVOKE EXECUTE ON FUNCTION private.evaluate_current_auth_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.evaluate_current_auth_access() FROM anon;
REVOKE EXECUTE ON FUNCTION private.evaluate_current_auth_access() FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Internal helpers
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.is_current_session_fully_authorized()
RETURNS boolean
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := private.evaluate_current_auth_access();
  RETURN (v_result ->> 'access_level') = 'FULL';
END;
$$;

REVOKE EXECUTE ON FUNCTION private.is_current_session_fully_authorized() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.is_current_session_fully_authorized() FROM anon;
GRANT EXECUTE ON FUNCTION private.is_current_session_fully_authorized() TO authenticated;

CREATE OR REPLACE FUNCTION private.assert_current_session_fully_authorized()
RETURNS void
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := private.evaluate_current_auth_access();
  IF (v_result ->> 'access_level') <> 'FULL' THEN
    RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.assert_current_session_fully_authorized() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.assert_current_session_fully_authorized() FROM anon;
REVOKE EXECUTE ON FUNCTION private.assert_current_session_fully_authorized() FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Safe Bootstrap RPC
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_auth_access_state()
RETURNS jsonb
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := private.evaluate_current_auth_access();
  RETURN jsonb_build_object(
    'has_session', (v_result ->> 'has_session')::boolean,
    'access_level', v_result ->> 'access_level',
    'reason_code', v_result ->> 'reason_code',
    'next_step', v_result ->> 'next_step',
    'user_id', v_result ->> 'user_id',
    'session_id', v_result ->> 'session_id',
    'account_status', v_result ->> 'account_status',
    'profile_completion_status', v_result ->> 'profile_completion_status',
    'mfa_required', (v_result ->> 'mfa_required')::boolean,
    'has_verified_totp', (v_result ->> 'has_verified_totp')::boolean,
    'current_aal', v_result ->> 'current_aal'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_auth_access_state() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_auth_access_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_auth_access_state() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. PostgREST Pre-request Gate
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.enforce_auth_access_pre_request()
RETURNS void
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
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
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN;
  END IF;

  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_result := private.evaluate_current_auth_access();
  v_access_level := v_result ->> 'access_level';

  IF v_access_level = 'FULL' THEN
    RETURN;
  END IF;

  v_path := current_setting('request.path', true);
  v_normalized_path := lower(trim(leading '/' from split_part(v_path, '?', 1)));

  IF v_normalized_path = ANY(v_allowed_paths) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() FROM anon;
REVOKE EXECUTE ON FUNCTION private.enforce_auth_access_pre_request() FROM authenticated;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'private.enforce_auth_access_pre_request';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Global Restrictive RLS Gate
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
  policy_exists boolean;
BEGIN
  FOR r IN
    SELECT c.relname, c.oid
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND EXISTS (
        SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid
        AND p.polroles @> ARRAY['authenticated'::regrole::oid]
      )
    ORDER BY c.relname
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = r.oid AND p.polname = 'auth_global_full_access_gate'
    ) INTO policy_exists;

    IF NOT policy_exists THEN
      EXECUTE format(
        'CREATE POLICY auth_global_full_access_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT private.is_current_session_fully_authorized())) WITH CHECK ((SELECT private.is_current_session_fully_authorized()))',
        r.relname
      );
    END IF;
  END LOOP;
END $$;

-- system_config: custom gate allowing public section reads for restricted sessions
DO $$
BEGIN
  DROP POLICY IF EXISTS auth_global_full_access_gate ON public.system_config;
  CREATE POLICY auth_global_full_access_gate ON public.system_config
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
      (SELECT private.is_current_session_fully_authorized())
      OR section IN ('general', 'appearance')
    )
    WITH CHECK (
      (SELECT private.is_current_session_fully_authorized())
    );
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. profiles_public: security_invoker=true
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.profiles_public;

CREATE VIEW public.profiles_public
WITH (security_invoker=true, security_barrier=true) AS
SELECT p.user_id,
    p.full_name,
    p.username,
    p.avatar_url,
    p."position",
    p.department,
    p.organization,
    p.primary_unit_id,
    u.name AS primary_unit_name,
    p.primary_position_id,
    pos.title AS primary_position_title,
    p.is_active,
    p.is_hidden
   FROM public.profiles p
     LEFT JOIN public.org_positions pos ON pos.id = p.primary_position_id
     LEFT JOIN public.org_units u ON u.id = p.primary_unit_id
  WHERE p.is_active = true AND COALESCE(p.is_hidden, false) = false AND p.organization = (( SELECT pr.organization
           FROM public.profiles pr
          WHERE pr.user_id = auth.uid()
         LIMIT 1));

GRANT SELECT ON public.profiles_public TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Revoke dangerous privileges from anon and authenticated
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon', r.table_name);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', r.table_name);
  END LOOP;
END $$;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON storage.objects FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON storage.objects FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Storage Gate
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS auth_global_storage_read_gate ON storage.objects;
CREATE POLICY auth_global_storage_read_gate ON storage.objects
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT private.is_current_session_fully_authorized())
    OR EXISTS (
      SELECT 1 FROM storage.buckets b
      WHERE b.id = storage.objects.bucket_id AND b.public = true
    )
  );

DROP POLICY IF EXISTS auth_global_storage_write_gate ON storage.objects;
CREATE POLICY auth_global_storage_write_gate ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_current_session_fully_authorized()))
  WITH CHECK ((SELECT private.is_current_session_fully_authorized()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. Revoke EXECUTE on backend-only functions callable by authenticated
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname LIKE '\_%'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ORDER BY p.proname
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.oid::regprocedure::text);
  END LOOP;

  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'write_denied_audit',
        'guard_security_role_columns',
        'guard_protected_profile_fields',
        'guard_protected_profile_fields_insert',
        'sanitize_audit_metadata',
        'sync_normalized_profile_fields',
        'create_default_calendars_for_user',
        'check_phone_login_dependencies_ready',
        'check_phone_login_readiness'
      )
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ORDER BY p.proname
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.oid::regprocedure::text);
  END LOOP;
END $$;
