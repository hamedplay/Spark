-- Restore get_phone_auth_config to return TABLE format
-- (the deployed edge functions expect TABLE, not jsonb)
DROP FUNCTION IF EXISTS public.get_phone_auth_config();

CREATE OR REPLACE FUNCTION public.get_phone_auth_config()
RETURNS TABLE (pepper text, allowed_origins text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT value FROM system_config WHERE section = 'security' AND key = 'phone_auth_pepper' LIMIT 1), '') AS pepper,
    COALESCE(
      (SELECT string_to_array(
        (SELECT value FROM system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1),
        ','
      )),
      ARRAY[]::text[]
    ) AS allowed_origins;
$$;

REVOKE EXECUTE ON FUNCTION public.get_phone_auth_config() FROM anon, authenticated;