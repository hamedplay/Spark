-- Allow the canonical authenticated bootstrap RPC to evaluate and report the
-- caller's access state before the global PostgREST pre-request gate requires
-- that same state to already be FULL. All non-bootstrap application endpoints
-- remain protected by private.is_current_session_fully_authorized().

CREATE OR REPLACE FUNCTION private.enforce_auth_access_pre_request()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_path text;
  v_uid uuid;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN;
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_path := lower(trim(leading '/' from current_setting('request.path', true)));

  IF v_path IN (
    'rpc/get_my_auth_access_state',
    'rpc/get_my_auth_access_state_v3',
    'rpc/get_my_app_bootstrap_v1',
    'rpc/get_public_auth_config',
    'rpc/get_public_login_methods',
    'rpc/get_my_profile_completion_state',
    'rpc/save_my_profile_completion'
  ) THEN
    RETURN;
  END IF;

  IF NOT private.is_current_session_fully_authorized() THEN
    RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;
