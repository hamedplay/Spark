-- Centralize ACL policy for public postgres-owned SECURITY DEFINER functions.
--
-- Security model:
--   * PUBLIC and anon get no EXECUTE by default.
--   * authenticated gets EXECUTE only for explicitly allowlisted browser RPCs.
--   * service_role gets EXECUTE on every postgres-owned public SECURITY DEFINER function.
--   * future postgres-owned public functions inherit no browser EXECUTE by default.
--
-- This preserves fail-closed restore hardening without breaking intentional
-- browser-facing SECURITY DEFINER RPCs that enforce authorization internally.

CREATE TABLE IF NOT EXISTS private.security_definer_rpc_acl_allowlist (
  signature text PRIMARY KEY,
  allow_authenticated boolean NOT NULL DEFAULT false,
  allow_anon boolean NOT NULL DEFAULT false,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.security_definer_rpc_acl_allowlist FROM PUBLIC, anon, authenticated;

INSERT INTO private.security_definer_rpc_acl_allowlist
  (signature, allow_authenticated, allow_anon, rationale)
VALUES
  ('public.add_meeting_participant_as_informee(uuid,uuid)', true, false, 'Authenticated meeting informee workflow; function validates caller and organization scope.'),
  ('public.clear_malformed_phone_record(uuid)', true, false, 'Security-admin UI wrapper; private implementation enforces authorization.'),
  ('public.disable_my_pwa_push_subscription(text)', true, false, 'Self-service PWA subscription RPC scoped to auth.uid().'),
  ('public.get_management_capabilities_v1()', true, false, 'Management UI RPC; validates fully authorized session and management_dashboard permission.'),
  ('public.get_management_decisions_v3(text,text,uuid,uuid,text,integer,integer)', true, false, 'Management UI RPC; validates session and management_decisions.view permission.'),
  ('public.get_management_minutes_dashboard_stats_v1()', true, false, 'Management minutes dashboard RPC; validates management_dashboard permission.'),
  ('public.get_management_minutes_v1(text,text,text,integer,integer)', true, false, 'Management minutes RPC; validates fully authorized session and management_dashboard permission.'),
  ('public.get_management_scope_people_v1()', true, false, 'Management scope RPC; validates fully authorized session and management_dashboard permission.'),
  ('public.get_management_tasks_v2(text,text,uuid,text,integer,integer)', true, false, 'Management tasks RPC; validates fully authorized session and management_tasks.view permission.'),
  ('public.get_mfa_policy_state()', true, false, 'Authenticated MFA policy read scoped to current user.'),
  ('public.get_my_informee_meetings_v1()', true, false, 'Self-scoped informee meeting read using auth.uid().'),
  ('public.get_my_meeting_delegations_v1()', true, false, 'Self-scoped delegation wrapper; private implementation validates current session and auth.uid().'),
  ('public.get_my_profile_completion_state()', true, false, 'Self-service profile completion wrapper; private implementation validates caller.'),
  ('public.has_management_dashboard_access_v1()', true, false, 'Authenticated capability check; validates fully authorized session and permission.'),
  ('public.is_video_conference_enabled()', true, false, 'Authenticated feature-flag read used by the client.'),
  ('public.list_locked_accounts()', true, false, 'Security-admin UI wrapper; private implementation validates session and security-admin role.'),
  ('public.list_malformed_phone_records()', true, false, 'Security-admin UI wrapper; private implementation validates authorization.'),
  ('public.save_my_profile_completion(jsonb,bigint,boolean)', true, false, 'Self-service profile completion wrapper; private implementation validates caller.'),
  ('public.security_admin_unlock_account(uuid)', true, false, 'Security-admin action wrapper; private implementation validates security-admin authorization.'),
  ('public.set_auth_security_settings_patch(integer,jsonb,text)', true, false, 'Security-admin settings RPC; explicitly requires auth.uid() and security-admin authorization.'),
  ('public.set_maintenance_mode(boolean)', true, false, 'Admin maintenance control wrapper; private implementation validates authorization.'),
  ('public.upsert_my_pwa_push_subscription(text,text,text,text)', true, false, 'Self-service PWA subscription RPC scoped to auth.uid().')
ON CONFLICT (signature) DO UPDATE
SET allow_authenticated = EXCLUDED.allow_authenticated,
    allow_anon = EXCLUDED.allow_anon,
    rationale = EXCLUDED.rationale,
    updated_at = now();

CREATE OR REPLACE FUNCTION private.apply_public_security_definer_acl_policy()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  r record;
  v_invalid_allowlist integer := 0;
  v_non_postgres_owner integer := 0;
  v_anon_unapproved integer := 0;
  v_authenticated_unapproved integer := 0;
  v_expected_anon_missing integer := 0;
  v_expected_authenticated_missing integer := 0;
  v_service_missing integer := 0;
BEGIN
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'Required Supabase roles are missing';
  END IF;

  SELECT count(*)
  INTO v_invalid_allowlist
  FROM private.security_definer_rpc_acl_allowlist a
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.signature)
  LEFT JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.oid IS NULL
     OR n.nspname <> 'public'
     OR p.prosecdef IS DISTINCT FROM true
     OR p.proowner <> 'postgres'::regrole;

  IF v_invalid_allowlist <> 0 THEN
    RAISE EXCEPTION 'Invalid SECURITY DEFINER ACL allowlist entries: %', v_invalid_allowlist;
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
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

  FOR r IN
    SELECT a.signature, a.allow_authenticated, a.allow_anon
    FROM private.security_definer_rpc_acl_allowlist a
    ORDER BY a.signature
  LOOP
    IF r.allow_authenticated THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.signature);
    END IF;
    IF r.allow_anon THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.signature);
    END IF;
  END LOOP;

  SELECT count(*)
  INTO v_non_postgres_owner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proowner <> 'postgres'::regrole;

  IF v_non_postgres_owner <> 0 THEN
    RAISE EXCEPTION 'Unexpected non-postgres-owned public SECURITY DEFINER functions: %', v_non_postgres_owner;
  END IF;

  SELECT count(*)
  INTO v_anon_unapproved
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM private.security_definer_rpc_acl_allowlist a
      WHERE a.allow_anon
        AND to_regprocedure(a.signature) = p.oid
    );

  SELECT count(*)
  INTO v_authenticated_unapproved
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM private.security_definer_rpc_acl_allowlist a
      WHERE a.allow_authenticated
        AND to_regprocedure(a.signature) = p.oid
    );

  SELECT count(*)
  INTO v_expected_anon_missing
  FROM private.security_definer_rpc_acl_allowlist a
  WHERE a.allow_anon
    AND NOT has_function_privilege('anon', to_regprocedure(a.signature), 'EXECUTE');

  SELECT count(*)
  INTO v_expected_authenticated_missing
  FROM private.security_definer_rpc_acl_allowlist a
  WHERE a.allow_authenticated
    AND NOT has_function_privilege('authenticated', to_regprocedure(a.signature), 'EXECUTE');

  SELECT count(*)
  INTO v_service_missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proowner = 'postgres'::regrole
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

  IF v_anon_unapproved <> 0 OR v_authenticated_unapproved <> 0 THEN
    RAISE EXCEPTION
      'Unapproved client-executable public SECURITY DEFINER functions remain (anon=%, authenticated=%)',
      v_anon_unapproved, v_authenticated_unapproved;
  END IF;

  IF v_expected_anon_missing <> 0 OR v_expected_authenticated_missing <> 0 THEN
    RAISE EXCEPTION
      'Expected allowlisted browser RPC grants are missing (anon=%, authenticated=%)',
      v_expected_anon_missing, v_expected_authenticated_missing;
  END IF;

  IF v_service_missing <> 0 THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on % public SECURITY DEFINER functions', v_service_missing;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'authenticated_allowlisted', (
      SELECT count(*) FROM private.security_definer_rpc_acl_allowlist WHERE allow_authenticated
    ),
    'anon_allowlisted', (
      SELECT count(*) FROM private.security_definer_rpc_acl_allowlist WHERE allow_anon
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_public_security_definer_acl_policy() FROM PUBLIC, anon, authenticated;

-- Future postgres-owned public functions start service-only until explicitly
-- reviewed and added to the allowlist in a migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- Apply and validate the policy immediately. This also removes the accidental
-- anon grant previously present on set_auth_security_settings_patch().
SELECT private.apply_public_security_definer_acl_policy();
