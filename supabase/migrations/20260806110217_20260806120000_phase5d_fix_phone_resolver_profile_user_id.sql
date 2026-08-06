-- Phase 5D Fix: Use profiles.user_id instead of profiles.id in resolve_phone_password_login_v1
-- The original migration used p.id (the profile row PK) instead of p.user_id (the auth user FK).
-- In all 28 profile rows, profiles.id != profiles.user_id, so the RPC always returned 0 rows.

CREATE OR REPLACE FUNCTION public.resolve_phone_password_login_v1(
  p_normalized_phone text
)
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_profile_count integer;
  v_profile_user_id uuid;
  v_auth_count integer;
  v_auth_user_id uuid;
BEGIN
  IF p_normalized_phone IS NULL
     OR p_normalized_phone !~ '^989[0-9]{9}$' THEN
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_profile_count
  FROM public.profiles p
  WHERE p.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(p.phone)
        = p_normalized_phone;

  IF v_profile_count <> 1 THEN
    RETURN;
  END IF;

  SELECT p.user_id
  INTO v_profile_user_id
  FROM public.profiles p
  WHERE p.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(p.phone)
        = p_normalized_phone
  LIMIT 1;

  IF v_profile_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_auth_count
  FROM auth.users u
  WHERE u.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(u.phone)
        = p_normalized_phone
    AND u.email IS NOT NULL
    AND btrim(u.email) <> '';

  IF v_auth_count <> 1 THEN
    RETURN;
  END IF;

  SELECT u.id
  INTO v_auth_user_id
  FROM auth.users u
  WHERE u.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(u.phone)
        = p_normalized_phone
    AND u.email IS NOT NULL
    AND btrim(u.email) <> ''
  LIMIT 1;

  IF v_profile_user_id IS DISTINCT FROM v_auth_user_id THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_auth_user_id;
END;
$$;

ALTER FUNCTION public.resolve_phone_password_login_v1(text) OWNER TO postgres;

REVOKE EXECUTE
ON FUNCTION public.resolve_phone_password_login_v1(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.resolve_phone_password_login_v1(text)
TO service_role;
