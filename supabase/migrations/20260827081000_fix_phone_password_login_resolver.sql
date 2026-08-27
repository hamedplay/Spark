-- Fix phone+password login for verified profile phones when auth.users.phone is not populated.
-- The password gateway resolves a verified profile user first, then authenticates the
-- corresponding auth.users account with a confirmed credential (email preferred).

CREATE OR REPLACE FUNCTION public.resolve_phone_password_login_v1(
  p_normalized_phone text
)
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_count integer;
  v_profile_user_id uuid;
BEGIN
  IF p_normalized_phone IS NULL
     OR p_normalized_phone !~ '^989[0-9]{9}$' THEN
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_profile_count
  FROM public.profiles p
  JOIN auth.users u
    ON u.id = p.user_id
   AND u.deleted_at IS NULL
  WHERE p.is_active = true
    AND p.phone_verified_at IS NOT NULL
    AND p.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(p.phone) = p_normalized_phone;

  IF v_profile_count <> 1 THEN
    RETURN;
  END IF;

  SELECT p.user_id
  INTO v_profile_user_id
  FROM public.profiles p
  JOIN auth.users u
    ON u.id = p.user_id
   AND u.deleted_at IS NULL
  WHERE p.is_active = true
    AND p.phone_verified_at IS NOT NULL
    AND p.phone IS NOT NULL
    AND public.normalize_iran_phone_sql(p.phone) = p_normalized_phone
  LIMIT 1;

  IF v_profile_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_profile_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_phone_password_login_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_phone_password_login_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_phone_password_login_v1(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_phone_password_login_v1(text) TO service_role;
