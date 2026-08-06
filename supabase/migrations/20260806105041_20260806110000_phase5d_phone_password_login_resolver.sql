-- Phase 5D: Phone Password Login Resolver
-- Resolves a canonical Iranian phone number to a user_id without depending on GoTrue Phone Provider.
-- Only service_role can execute. Returns user_id only — never email, phone, or profile data.

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
  v_profile_user_id uuid;
  v_auth_user_id uuid;
BEGIN
  -- Validate canonical phone format: ^989[0-9]{9}$
  IF p_normalized_phone IS NULL OR NOT (p_normalized_phone ~ '^989[0-9]{9}$') THEN
    RETURN;
  END IF;

  -- Resolve from profiles
  SELECT p.id INTO v_profile_user_id
  FROM public.profiles p
  WHERE p.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(p.phone) = p_normalized_phone
  LIMIT 1;

  -- Must be exactly one match
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF (
    SELECT count(*)
    FROM public.profiles p
    WHERE p.phone IS NOT NULL
      AND public.normalize_iran_phone_sql(p.phone) = p_normalized_phone
  ) > 1 THEN
    RETURN;
  END IF;

  -- Resolve from auth.users
  SELECT u.id INTO v_auth_user_id
  FROM auth.users u
  WHERE u.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(u.phone) = p_normalized_phone
    AND u.email IS NOT NULL
    AND btrim(u.email) <> ''
  LIMIT 1;

  -- Must be exactly one match
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF (
    SELECT count(*)
    FROM auth.users u
    WHERE u.phone IS NOT NULL
      AND public.normalize_iran_phone_sql(u.phone) = p_normalized_phone
      AND u.email IS NOT NULL
      AND btrim(u.email) <> ''
  ) > 1 THEN
    RETURN;
  END IF;

  -- User IDs must match
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
