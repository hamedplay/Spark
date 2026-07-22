/*
# Fix ambiguous column reference in resolve_phone_password_reset_target

The first SELECT in the RPC had `user_id` and `phone` in the SELECT list
without table qualification, causing ambiguity with PL/pgSQL variables.
This migration drops and recreates the function with fully-qualified column
references.
*/

DROP FUNCTION IF EXISTS public.resolve_phone_password_reset_target(text);

CREATE OR REPLACE FUNCTION public.resolve_phone_password_reset_target(
  p_normalized_phone text
)
RETURNS TABLE(user_id uuid, resolved_phone_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_count int;
  v_profile_user_id uuid;
  v_profile_phone text;
  v_auth_count int;
  v_auth_user_id uuid;
  v_auth_phone text;
BEGIN
  -- Count all active profiles with matching phone
  SELECT count(*) INTO v_profile_count
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = p_normalized_phone;

  IF v_profile_count = 0 OR v_profile_count > 1 THEN
    RETURN;
  END IF;

  -- Get the single matching profile
  SELECT profiles.user_id, profiles.phone
  INTO v_profile_user_id, v_profile_phone
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = p_normalized_phone
  LIMIT 1;

  -- Count auth users with matching phone
  SELECT count(*) INTO v_auth_count
  FROM auth.users
  WHERE phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = p_normalized_phone;

  IF v_auth_count = 0 OR v_auth_count > 1 THEN
    RETURN;
  END IF;

  -- Get the single matching auth user
  SELECT users.id, users.phone
  INTO v_auth_user_id, v_auth_phone
  FROM auth.users
  WHERE phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = p_normalized_phone
  LIMIT 1;

  -- user_id must match
  IF v_auth_user_id IS NULL OR v_auth_user_id <> v_profile_user_id THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_profile_user_id, p_normalized_phone;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_phone_password_reset_target(text) FROM PUBLIC, anon, authenticated;
