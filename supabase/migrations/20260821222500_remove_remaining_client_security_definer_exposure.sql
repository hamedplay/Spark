-- Remove the remaining signed-in SECURITY DEFINER exposure without changing
-- active application contracts.
--
-- 1) Eleven legacy browser RPCs are no longer used by the current frontend.
--    Modern Bale/MFA/recovery flows use Edge Functions and service-role/service
--    RPCs, so authenticated EXECUTE is removed while service_role is preserved.
-- 2) has_management_dashboard_access_v1() is still called by the browser. Keep
--    the exact public RPC name/signature, but make it SECURITY INVOKER and route
--    it through the already-hardened current-user permission API.
-- 3) mfa_switch_intents already behaved as default-deny because RLS was enabled
--    with no policies. Add an explicit deny policy so behavior is unchanged and
--    the database advisor no longer reports an empty policy set.

-- Legacy RPCs: server-side callers keep service_role access; browser roles do not.
REVOKE EXECUTE ON FUNCTION public.consume_custom_mfa_challenge_hash(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_custom_mfa_recovery_hash(text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_bale_link_nonce()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_custom_mfa_challenge(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_custom_mfa_state()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.regenerate_custom_mfa_recovery_codes()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_custom_mfa_grant(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_phone_password_recovery_config(boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_phone_password_recovery_test_mode(boolean, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_custom_mfa_challenge(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_custom_mfa_recovery(text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_custom_mfa_challenge_hash(uuid, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_custom_mfa_recovery_hash(text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_bale_link_nonce()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_custom_mfa_challenge(text, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_custom_mfa_state()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.regenerate_custom_mfa_recovery_codes()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_custom_mfa_grant(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_config(boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_test_mode(boolean, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_custom_mfa_challenge(uuid, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_custom_mfa_recovery(text, uuid)
  TO service_role;

-- Preserve the active browser contract while removing SECURITY DEFINER from the
-- exposed public RPC. has_current_permission_v1() is SECURITY INVOKER and its
-- private current-user helper performs the existing FULL-session gate.
CREATE OR REPLACE FUNCTION public.has_management_dashboard_access_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT public.has_current_permission_v1('management_dashboard')
$function$;

REVOKE EXECUTE ON FUNCTION public.has_management_dashboard_access_v1()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_management_dashboard_access_v1()
  TO authenticated, service_role;

-- Explicitly preserve the current default-deny behavior for browser roles.
DROP POLICY IF EXISTS mfa_switch_intents_explicit_deny ON public.mfa_switch_intents;
CREATE POLICY mfa_switch_intents_explicit_deny
ON public.mfa_switch_intents
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- Fail closed if any exposed SECURITY DEFINER function remains callable by a
-- browser role after this migration.
DO $block$
DECLARE
  v_anon_sd integer;
  v_auth_sd integer;
  v_service_missing integer;
  v_mgmt_is_definer boolean;
  v_mgmt_auth_exec boolean;
  v_policy_count integer;
BEGIN
  SELECT count(*)
  INTO v_anon_sd
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  SELECT count(*)
  INTO v_auth_sd
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_anon_sd <> 0 OR v_auth_sd <> 0 THEN
    RAISE EXCEPTION 'Client-executable public SECURITY DEFINER functions remain (anon=%, authenticated=%)',
      v_anon_sd, v_auth_sd;
  END IF;

  SELECT p.prosecdef,
         has_function_privilege('authenticated', p.oid, 'EXECUTE')
  INTO v_mgmt_is_definer, v_mgmt_auth_exec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid = 'public.has_management_dashboard_access_v1()'::regprocedure;

  IF v_mgmt_is_definer OR NOT v_mgmt_auth_exec THEN
    RAISE EXCEPTION 'Management dashboard RPC contract/hardening is invalid';
  END IF;

  SELECT count(*)
  INTO v_service_missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

  IF v_service_missing <> 0 THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on % public SECURITY DEFINER functions', v_service_missing;
  END IF;

  SELECT count(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'mfa_switch_intents'
    AND policyname = 'mfa_switch_intents_explicit_deny';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'Explicit mfa_switch_intents deny policy was not created';
  END IF;
END
$block$;
