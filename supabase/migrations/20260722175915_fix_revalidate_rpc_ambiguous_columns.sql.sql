/*
# Fix revalidate_phone_password_reset_target ambiguous column reference

The revalidate RPC had a redundant first count query with unqualified
column references causing ambiguity. This migration drops and recreates
the function with clean, qualified column references and removes the
redundant query block.
*/

DROP FUNCTION IF EXISTS public.revalidate_phone_password_reset_target(uuid);

CREATE OR REPLACE FUNCTION public.revalidate_phone_password_reset_target(
  p_challenge_id uuid
)
RETURNS TABLE(
  valid boolean,
  user_id uuid,
  normalized_phone text,
  phone_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge record;
  v_profile record;
  v_auth_user record;
  v_profile_count int;
  v_auth_count int;
  v_profile_normalized text;
  v_auth_normalized text;
BEGIN
  -- 1. Read challenge by p_challenge_id
  SELECT * INTO v_challenge
  FROM public.phone_password_reset_challenges
  WHERE id = p_challenge_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 2. Find the profile by user_id from challenge
  SELECT profiles.user_id, profiles.phone, profiles.is_active INTO v_profile
  FROM public.profiles
  WHERE profiles.user_id = v_challenge.user_id
  LIMIT 1;

  IF NOT FOUND OR v_profile.is_active <> true THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_profile_normalized := public.normalize_iran_phone_sql(v_profile.phone);

  -- 3. Check exactly one active profile has this normalized phone
  SELECT count(*) INTO v_profile_count
  FROM public.profiles
  WHERE profiles.is_active = true
    AND profiles.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(profiles.phone) = v_profile_normalized;

  IF v_profile_count <> 1 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 4. Find auth user by user_id from challenge
  SELECT users.id, users.phone INTO v_auth_user
  FROM auth.users
  WHERE users.id = v_challenge.user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_auth_normalized := public.normalize_iran_phone_sql(v_auth_user.phone);

  -- 5. Check exactly one auth user has this normalized phone
  SELECT count(*) INTO v_auth_count
  FROM auth.users
  WHERE users.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(users.phone) = v_auth_normalized;

  IF v_auth_count <> 1 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 6. Profile user_id, Auth User id, and Challenge user_id must all be the same
  IF v_profile.user_id <> v_auth_user.id OR v_profile.user_id <> v_challenge.user_id THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 7. Auth and Profile normalized phones must match
  IF v_auth_normalized <> v_profile_normalized THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 8. Return valid with normalized_phone and phone_hash from challenge
  -- No raw phone is returned or logged
  RETURN QUERY SELECT true, v_challenge.user_id, v_profile_normalized, v_challenge.phone_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.revalidate_phone_password_reset_target(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revalidate_phone_password_reset_target(uuid) TO service_role;
