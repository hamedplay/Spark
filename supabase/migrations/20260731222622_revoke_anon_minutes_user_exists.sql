/*
# Revoke anon execute on _minutes_user_exists

## Problem
The previous migration `fix_create_minutes_draft_profile_lookup` created
`public._minutes_user_exists(uuid)` with `REVOKE ALL ON FUNCTION ... FROM PUBLIC`,
but the `anon` role can still execute it because Supabase grants execute to
`anon` explicitly (not just via `PUBLIC`).

## Fix
Explicitly `REVOKE EXECUTE ON FUNCTION public._minutes_user_exists(uuid) FROM anon`.

## Security
- No data is changed.
- `authenticated` and `service_role` keep execute (they need it).
- `anon` loses execute — it should never call this helper.
*/

REVOKE EXECUTE ON FUNCTION public._minutes_user_exists(uuid) FROM anon;
