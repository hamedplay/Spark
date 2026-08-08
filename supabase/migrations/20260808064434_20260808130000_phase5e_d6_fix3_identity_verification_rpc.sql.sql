/*
# Phase 5E-D6 Fix 3 — Identity Verification RPC

## Purpose
The bulk-sync-profile-phones edge function cannot read `auth.identities` via the
Data API because `service_role` has USAGE on the `auth` schema but NOT SELECT
on `auth.identities`. Opening `auth.identities` to the Data API is a security
risk. This migration creates a SECURITY DEFINER RPC that reads `auth.identities`
server-side and returns only safe boolean/count fields.

## Changes
1. New function `public.get_phone_auth_identity_state_v1(p_user_id, p_expected_normalized_phone)`
   - SECURITY DEFINER, owner = postgres, search_path = '' (empty, schema-qualified objects)
   - Read-only: queries auth.identities and auth.users, no writes
   - Returns: identity_count, exactly_one_phone_identity, identity_same_user,
     identity_sub_matches_user, identity_phone_matches, identity_phone_verified
   - Uses public.normalize_iran_phone for phone comparison
   - Fail-closed: if multiple phone identities, exactly_one = false
2. Permissions: REVOKE ALL from PUBLIC/anon/authenticated, GRANT EXECUTE to service_role only
3. No direct SELECT privilege on auth.identities is granted to service_role

## Security
- No RLS changes
- No new tables
- No data modifications
- Resolver resolve_phone_password_login_v1 is NOT touched
*/

CREATE OR REPLACE FUNCTION public.get_phone_auth_identity_state_v1(
  p_user_id uuid,
  p_expected_normalized_phone text
)
RETURNS TABLE(
  identity_count int,
  exactly_one_phone_identity boolean,
  identity_same_user boolean,
  identity_sub_matches_user boolean,
  identity_phone_matches boolean,
  identity_phone_verified boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_identity_count int;
  v_identity_data jsonb;
  v_identity_sub text;
  v_identity_phone text;
  v_identity_phone_verified boolean;
  v_identity_email_verified boolean;
  v_normalized_identity_phone text;
  v_expected text;
BEGIN
  v_expected := NULLIF(TRIM(p_expected_normalized_phone), '');

  SELECT count(*)
  INTO v_identity_count
  FROM auth.identities
  WHERE auth.identities.user_id = p_user_id
    AND auth.identities.provider = 'phone';

  IF v_identity_count = 0 THEN
    RETURN QUERY SELECT
      0,
      false,
      false,
      false,
      false,
      false;
    RETURN;
  END IF;

  IF v_identity_count > 1 THEN
    RETURN QUERY SELECT
      v_identity_count,
      false,
      false,
      false,
      false,
      false;
    RETURN;
  END IF;

  -- Exactly one — fetch its data
  SELECT auth.identities.identity_data
  INTO v_identity_data
  FROM auth.identities
  WHERE auth.identities.user_id = p_user_id
    AND auth.identities.provider = 'phone'
  LIMIT 1;

  v_identity_sub := v_identity_data ->> 'sub';
  v_identity_phone := v_identity_data ->> 'phone';
  v_identity_phone_verified := COALESCE((v_identity_data ->> 'phone_verified')::boolean, false);
  v_identity_email_verified := COALESCE((v_identity_data ->> 'email_verified')::boolean, false);

  v_normalized_identity_phone := public.normalize_iran_phone(v_identity_phone);

  RETURN QUERY SELECT
    1,
    true,
    true,
    (v_identity_sub = p_user_id::text),
    (v_normalized_identity_phone = v_expected AND v_expected IS NOT NULL),
    v_identity_phone_verified;

  RETURN;
END;
$function$;

-- Lock down permissions
REVOKE ALL ON FUNCTION public.get_phone_auth_identity_state_v1(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_phone_auth_identity_state_v1(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_phone_auth_identity_state_v1(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_phone_auth_identity_state_v1(uuid, text) TO service_role;
