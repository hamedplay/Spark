-- Repair function ACLs after a database restore that recreated public
-- SECURITY DEFINER functions with the target project's permissive defaults.
--
-- Scope:
--   * ACLs of existing public SECURITY DEFINER functions only.
--   * Default EXECUTE privileges for future postgres-owned functions in public.
--
-- Function bodies, RLS policies, triggers, data and SECURITY INVOKER RPCs are
-- intentionally unchanged.

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
      AND p.proowner = 'postgres'::regrole
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

-- Prevent future postgres-owned public functions from inheriting the same
-- browser EXECUTE exposure after this repair.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- Fail closed if the repair did not reach the expected security state.
DO $block$
DECLARE
  v_anon_exposed integer;
  v_authenticated_exposed integer;
  v_service_missing integer;
  v_non_postgres_owner integer;
BEGIN
  SELECT count(*)
  INTO v_non_postgres_owner
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proowner <> 'postgres'::regrole;

  IF v_non_postgres_owner <> 0 THEN
    RAISE EXCEPTION 'Unexpected non-postgres-owned public SECURITY DEFINER functions: %', v_non_postgres_owner;
  END IF;

  SELECT count(*)
  INTO v_anon_exposed
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  SELECT count(*)
  INTO v_authenticated_exposed
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  SELECT count(*)
  INTO v_service_missing
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

  IF v_anon_exposed <> 0 OR v_authenticated_exposed <> 0 THEN
    RAISE EXCEPTION
      'Client-executable public SECURITY DEFINER functions remain (anon=%, authenticated=%)',
      v_anon_exposed, v_authenticated_exposed;
  END IF;

  IF v_service_missing <> 0 THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on % public SECURITY DEFINER functions', v_service_missing;
  END IF;
END
$block$;
