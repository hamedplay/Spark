/*
# Make get_email_by_username SECURITY DEFINER

## Why
Username login is broken at runtime. The function is currently
SECURITY INVOKER with `search_path=""`, and `public.profiles` has RLS
enabled with a SELECT policy scoped to `auth.uid() = user_id` for the
`authenticated` role only. The `anon` role has no SELECT policy on
`profiles`, so when an unauthenticated user (anon) calls
`get_email_by_username` during the login flow, the inner
`SELECT email FROM public.profiles` runs with anon's privileges and
fails with `permission denied for table profiles`. The RPC returns
null (or errors), so AuthPage cannot resolve the username to an email
and username login silently fails.

## Changes
1. Recreate `public.get_email_by_username(p_username text)` as
   `SECURITY DEFINER` so the inner SELECT runs with the function
   owner's (postgres) privileges, bypassing the anon RLS gap.
2. Keep `search_path = ''` and use the fully schema-qualified
   `public.profiles` in the body to prevent search_path injection.
3. Keep the exact signature and return type (`text`) — no change to
   the public contract.
4. Return only the `email` column (scalar or null). No other profile
   fields are exposed.
5. Revoke EXECUTE from PUBLIC to avoid unintended access.
6. Grant EXECUTE to `anon` and `authenticated` only (login happens
   before authentication, so anon must be able to call it).
7. Keep `service_role` EXECUTE (already present, harmless).

## Security notes
- The function still exposes whether a username exists (non-null vs
  null email) and returns the resolved email in the network response.
  This is the existing contract; this migration does NOT change that
  exposure. A future hardening step should move the lookup into a
  username-login Edge Function that does not return the email to the
  client and emits a single generic response.
- No new SELECT policy on `profiles` for anon is created. Direct
  `SELECT * FROM profiles` by anon remains blocked by RLS.
- No previous migration is modified.
*/

-- Recreate as SECURITY DEFINER with the same signature/return type.
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email
  FROM public.profiles
  WHERE lower(username) = lower(p_username)
  LIMIT 1;
  RETURN v_email;
END;
$function$;

-- Lock down grants: revoke PUBLIC, allow anon + authenticated only.
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(p_username text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(p_username text) TO anon, authenticated;
