-- Grant service_role the minimum privileges needed for PostgREST pre-request hook.
-- The pre-request function private.enforce_auth_access_pre_request() runs before every
-- request. service_role already has EXECUTE on it, but lacks USAGE on schema private,
-- causing "permission denied for schema private". The function returns immediately for
-- service_role, so this grant only allows the existing pre-request to execute.

GRANT USAGE ON SCHEMA private TO service_role;

GRANT EXECUTE
ON FUNCTION private.enforce_auth_access_pre_request()
TO service_role;
