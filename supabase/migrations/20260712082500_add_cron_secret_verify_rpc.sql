-- RPC function to verify X-Cron-Secret against vault-stored secret
-- Returns boolean only — never exposes the actual secret value
CREATE OR REPLACE FUNCTION public.verify_cron_secret(candidate text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
      AND decrypted_secret = candidate
  );
$$;

-- Revoke public access, grant only authenticated (service role bypasses RLS)
REVOKE EXECUTE ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO authenticated, service_role;
