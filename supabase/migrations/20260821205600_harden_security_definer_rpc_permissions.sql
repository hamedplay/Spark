-- Harden client-facing EXECUTE permissions for public SECURITY DEFINER functions.
--
-- Rationale:
--   * Sensitive helpers (secrets, crypto, workers, cron, admin/session mutations,
--     trigger helpers) must not be callable directly from browser roles.
--   * Existing login/OTP/recovery/MFA worker paths use service_role or a privileged
--     backend DB connection, so server-side execution remains available.
--   * A small compatibility allowlist retains authenticated access only for
--     self-bound/current-user RPCs that enforce their own auth context.
--
-- This changes ACLs only; function bodies, RLS policies, triggers, and data are
-- intentionally left unchanged.

DO $block$
DECLARE
  r record;
BEGIN
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'Required Supabase roles are missing';
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
    ORDER BY p.oid
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      r.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      r.signature
    );
  END LOOP;
END
$block$;

-- Secure-by-default for future application functions created by postgres in
-- public. Intentional browser RPCs must opt in with an explicit GRANT.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- Authenticated compatibility allowlist.
-- These signatures are deliberately exact so similarly named service helpers or
-- overloads do not become browser-callable accidentally.
GRANT EXECUTE ON FUNCTION public.create_bale_link_nonce()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_custom_mfa_challenge(text, uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_custom_mfa_challenge_hash(uuid, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_custom_mfa_recovery_hash(text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_custom_mfa_state()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_management_dashboard_access_v1()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_custom_mfa_recovery_codes()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_custom_mfa_grant(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_config(boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_test_mode(boolean, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_custom_mfa_challenge(uuid, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_custom_mfa_recovery(text, uuid)
  TO authenticated;

-- Fail closed if the final ACL state is not exactly what this hardening expects.
DO $block$
DECLARE
  v_anon_exposed integer;
  v_authenticated_exposed integer;
  v_service_missing integer;
  v_public_acl integer;
BEGIN
  SELECT count(*)
  INTO v_anon_exposed
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_anon_exposed <> 0 THEN
    RAISE EXCEPTION 'Unexpected anon-executable SECURITY DEFINER functions: %', v_anon_exposed;
  END IF;

  SELECT count(*)
  INTO v_authenticated_exposed
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_authenticated_exposed <> 12 THEN
    RAISE EXCEPTION 'Unexpected authenticated SECURITY DEFINER allowlist size: %', v_authenticated_exposed;
  END IF;

  SELECT count(*)
  INTO v_service_missing
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

  IF v_service_missing <> 0 THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on % SECURITY DEFINER functions', v_service_missing;
  END IF;

  SELECT count(*)
  INTO v_public_acl
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS x
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND x.grantee = 0
    AND x.privilege_type = 'EXECUTE';

  IF v_public_acl <> 0 THEN
    RAISE EXCEPTION 'PUBLIC still has EXECUTE on % SECURITY DEFINER functions', v_public_acl;
  END IF;
END
$block$;
