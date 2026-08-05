-- Phase 5A blocker fix: fail-closed get_public_login_methods
CREATE OR REPLACE FUNCTION public.get_public_login_methods()
RETURNS TABLE(
  username_login boolean,
  email_login boolean,
  phone_login boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row public.auth_security_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.auth_security_settings
  WHERE id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    COALESCE(v_row.username_login, false),
    COALESCE(v_row.email_login, false),
    COALESCE(v_row.phone_login, false);
END;
$function$;

ALTER FUNCTION public.get_public_login_methods() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.get_public_login_methods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_login_methods() TO anon, authenticated, service_role;
