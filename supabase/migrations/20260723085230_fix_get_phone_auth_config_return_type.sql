-- Drop and recreate get_phone_auth_config with jsonb return type
DROP FUNCTION IF EXISTS public.get_phone_auth_config();

CREATE FUNCTION public.get_phone_auth_config()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pepper', COALESCE((SELECT value FROM system_config WHERE section = 'security' AND key = 'phone_auth_pepper' LIMIT 1), ''),
    'allowed_origins', COALESCE(
      (SELECT string_to_array(
        (SELECT value FROM system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1),
        ','
      )),
      ARRAY[]::text[]
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_phone_auth_config() FROM anon, authenticated;