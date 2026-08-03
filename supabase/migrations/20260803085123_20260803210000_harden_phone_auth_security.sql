/*
# Harden phone auth security: REVOKE EXECUTE on sensitive functions + lock down phone_login_otp_challenges

## Summary

This migration tightens access control on phone-auth-related database functions and the
phone_login_otp_challenges table. It does NOT change any function logic, table structure,
or RLS policy logic. It only revokes EXECUTE privileges from PUBLIC/anon/authenticated
on sensitive functions that should only be callable by the service_role, and removes
direct table privileges from anon/authenticated on phone_login_otp_challenges.

## Functions affected (EXECUTE revoked from PUBLIC, anon, authenticated; kept for service_role)

1. `get_phone_auth_config()` — returns internal phone auth configuration
2. `bulk_classify_phone_sync(boolean)` — classifies phone sync status for all users
3. `diagnose_phone_auth_sync_status(uuid)` — diagnoses a specific user's phone sync
4. `resolve_phone_password_reset_target_detailed(text)` — resolves password reset target
5. `consume_phone_otp_verify_rate_limit(text, text)` — consumes OTP verify rate limit

## Table affected

- `phone_login_otp_challenges`: REVOKE all table privileges (SELECT, INSERT, UPDATE, DELETE,
  TRUNCATE, REFERENCES, TRIGGER) from `anon` and `authenticated`. RLS remains enabled.
  The existing service_role policy is preserved. service_role retains all privileges.

## Security notes

- No data is deleted, modified, or reset.
- No previous migration is changed.
- No CASCADE is added.
- RLS on phone_login_otp_challenges stays enabled with the existing service_role policy.
- search_path on all functions is already set to 'public' — no change needed.
- `get_public_auth_config` (the public-safe version) retains anon/authenticated access.
*/

-- ── REVOKE EXECUTE on sensitive functions ────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_phone_auth_config() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_phone_auth_config() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_phone_auth_config() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.bulk_classify_phone_sync(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_classify_phone_sync(boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bulk_classify_phone_sync(boolean) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.diagnose_phone_auth_sync_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.diagnose_phone_auth_sync_status(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.diagnose_phone_auth_sync_status(uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_phone_password_reset_target_detailed(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_phone_password_reset_target_detailed(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_phone_password_reset_target_detailed(text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.consume_phone_otp_verify_rate_limit(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_phone_otp_verify_rate_limit(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_phone_otp_verify_rate_limit(text, text) FROM authenticated;

-- ── REVOKE direct table access on phone_login_otp_challenges ─────────────────
REVOKE ALL PRIVILEGES ON TABLE public.phone_login_otp_challenges FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.phone_login_otp_challenges FROM authenticated;

-- Ensure RLS is enabled (idempotent — should already be enabled)
ALTER TABLE public.phone_login_otp_challenges ENABLE ROW LEVEL SECURITY;
