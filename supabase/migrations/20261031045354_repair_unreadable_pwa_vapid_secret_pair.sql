-- Repair VAPID provisioning when transferred Vault ciphertext cannot be decrypted.
-- Replacing a secret with vault.update_secret still decrypts its old value on
-- the inspected Vault 0.3.1 implementation. Create a fresh pair only if the old pair is unusable.
-- Applying this migration does not generate or rotate keys; the authenticated
-- initializer and existing worker continue calling this same service-only RPC.
CREATE OR REPLACE FUNCTION public.set_pwa_vapid_config_service(p_public_key text,p_private_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $keys$
BEGIN
  IF nullif(btrim(p_public_key),'') IS NULL OR nullif(btrim(p_private_key),'') IS NULL THEN
    RAISE EXCEPTION 'INVALID_VAPID_CONFIG';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('spark.pwa-vapid-initialization',0));
  -- Concurrent initializers always retain the first complete, readable pair.
  IF nullif(private.safe_vault_secret('pwa_vapid_public_key'),'') IS NOT NULL
     AND nullif(private.safe_vault_secret('pwa_vapid_private_key'),'') IS NOT NULL THEN
    RETURN;
  END IF;

  -- Only these two application-owned secrets are replaced. No old ciphertext is
  -- decrypted by the write path. If either create/readback fails, the enclosing
  -- transaction restores the original rows as well as removing any partial pair.
  DELETE FROM vault.secrets
  WHERE name IN ('pwa_vapid_public_key','pwa_vapid_private_key');
  PERFORM vault.create_secret(p_public_key,'pwa_vapid_public_key','Spark PWA VAPID public key',NULL);
  PERFORM vault.create_secret(p_private_key,'pwa_vapid_private_key','Spark PWA VAPID private key',NULL);

  IF private.safe_vault_secret('pwa_vapid_public_key') IS DISTINCT FROM p_public_key
     OR private.safe_vault_secret('pwa_vapid_private_key') IS DISTINCT FROM p_private_key THEN
    RAISE EXCEPTION 'VAPID_CONFIG_VERIFY_FAILED';
  END IF;
END;
$keys$;
REVOKE ALL ON FUNCTION public.set_pwa_vapid_config_service(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_pwa_vapid_config_service(text,text) TO service_role;

NOTIFY pgrst,'reload schema';
