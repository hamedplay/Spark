/*
# Fix check_public_registration_identifiers_available RPC

## Summary
Rewrites the `public.check_public_registration_identifiers_available` function
to properly normalize inputs (lower+trim for username/email, normalize_iran_phone
for phone), check both profiles and auth.users tables with consistent normalization,
and tighten security settings.

## Changes
1. Rewrites `public.check_public_registration_identifiers_available` with:
   - NULLIF(lower(btrim(...))) for username and email
   - public.normalize_iran_phone(...) for phone
   - Checks profiles.normalized_username, profiles.normalized_email, profiles.normalized_phone
   - Checks lower(auth.users.email) and public.normalize_iran_phone(auth.users.phone)
2. Security: SECURITY DEFINER, SET search_path TO '', OWNER TO postgres
3. Revokes EXECUTE from PUBLIC, anon, authenticated; grants only to service_role

## Safety
- No tables created or modified
- No data changed
- No RLS policies changed
- No existing migration modified
*/

CREATE OR REPLACE FUNCTION public.check_public_registration_identifiers_available(
  p_normalized_username text,
  p_normalized_email text,
  p_normalized_phone text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_username text;
  v_email text;
  v_phone text;
BEGIN
  v_username := NULLIF(lower(btrim(p_normalized_username)), '');
  v_email := NULLIF(lower(btrim(p_normalized_email)), '');
  v_phone := NULLIF(public.normalize_iran_phone(p_normalized_phone), '');

  IF v_username IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE normalized_username = v_username
  ) THEN
    RETURN false;
  END IF;

  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE normalized_email = v_email
  ) THEN
    RETURN false;
  END IF;

  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users WHERE lower(email) = v_email
  ) THEN
    RETURN false;
  END IF;

  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE normalized_phone = v_phone
  ) THEN
    RETURN false;
  END IF;

  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users WHERE public.normalize_iran_phone(phone) = v_phone
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

ALTER FUNCTION public.check_public_registration_identifiers_available(
  p_normalized_username text,
  p_normalized_email text,
  p_normalized_phone text
) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(
  p_normalized_username text,
  p_normalized_email text,
  p_normalized_phone text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(
  p_normalized_username text,
  p_normalized_email text,
  p_normalized_phone text
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(
  p_normalized_username text,
  p_normalized_email text,
  p_normalized_phone text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(
  p_normalized_username text,
  p_normalized_email text,
  p_normalized_phone text
) TO service_role;
