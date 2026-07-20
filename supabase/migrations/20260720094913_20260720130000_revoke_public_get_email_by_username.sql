/*
# Restrict get_email_by_username to service_role only

## Why
The username-login Edge Function is now the only consumer of
`get_email_by_username`. It runs server-side with the service-role
key. Previously anon and authenticated were granted EXECUTE so the
pre-auth frontend could resolve a username to an email, which exposed
the resolved email in the network response and allowed username
enumeration (non-null vs null). Username login now goes through the
Edge Function, which never returns the email to the client and emits a
single generic INVALID_CREDENTIALS response for both missing username
and wrong password.

## Changes
1. REVOKE EXECUTE on `get_email_by_username` from PUBLIC, anon, and
   authenticated.
2. GRANT EXECUTE to service_role only (the Edge Function's role).
3. No change to the function signature, return type, body, or
   SECURITY DEFINER setting.

## Security notes
- anon can no longer call the RPC directly (enumeration + email
  disclosure closed).
- authenticated can no longer call the RPC directly either; the only
  legitimate consumer is the service-role Edge Function.
- Direct anon SELECT on profiles remains blocked by RLS (unchanged).
- No previous migration is modified.
*/

REVOKE EXECUTE ON FUNCTION public.get_email_by_username(p_username text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(p_username text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(p_username text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(p_username text) TO service_role;
