-- Prevent restored/foreign Vault ciphertext from aborting unrelated application writes.
--
-- Self-hosted restores can carry vault.secrets ciphertext whose pgsodium key material
-- does not match the target server. In that case vault.decrypted_secrets raises
-- pgsodium_crypto_aead_det_decrypt_by_id: invalid ciphertext. Runtime callers that
-- treat Vault values as optional configuration must fail closed / no-op rather than
-- aborting the parent transaction (for example notifications -> PWA push dispatch).

CREATE OR REPLACE FUNCTION private.safe_vault_secret(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT ds.decrypted_secret
      INTO v_secret
    FROM vault.decrypted_secrets ds
    WHERE ds.name = p_name
    ORDER BY ds.created_at DESC
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  RETURN v_secret;
END;
$function$;

REVOKE ALL ON FUNCTION private.safe_vault_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.safe_vault_secret(text) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.dispatch_pwa_push_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_url text;
  v_token text;
BEGIN
  v_url := private.safe_vault_secret('pwa_push_function_url');
  v_token := private.safe_vault_secret('pwa_push_worker_token');

  IF nullif(v_url,'') IS NULL OR nullif(v_token,'') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Spark-Worker-Token',v_token
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pwa_vapid_config_service()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_public text;
  v_private text;
BEGIN
  v_public := private.safe_vault_secret('pwa_vapid_public_key');
  v_private := private.safe_vault_secret('pwa_vapid_private_key');
  RETURN jsonb_build_object('public_key', v_public, 'private_key', v_private);
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_pwa_push_worker_secret_service(p_candidate text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  v_secret := private.safe_vault_secret('pwa_push_worker_token');
  RETURN v_secret IS NOT NULL AND p_candidate IS NOT NULL AND v_secret = p_candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_registration_phone_otp_secret_service()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN private.safe_vault_secret('REGISTRATION_PHONE_OTP_SECRET');
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_cron_secret(candidate text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  IF candidate IS NULL OR length(candidate) < 32 THEN
    RETURN false;
  END IF;

  v_secret := private.safe_vault_secret('cron_secret');
  IF v_secret IS NULL THEN
    RETURN false;
  END IF;

  RETURN extensions.digest(v_secret, 'sha256') = extensions.digest(candidate, 'sha256');
END;
$function$;

CREATE OR REPLACE FUNCTION private.verify_conference_phase_worker_secret(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  v_secret := private.safe_vault_secret('conference_phase_worker_secret');
  RETURN v_secret IS NOT NULL AND p_secret IS NOT NULL AND v_secret = p_secret;
END;
$function$;

CREATE OR REPLACE FUNCTION private.verify_conference_speaker_timer_worker_secret(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  v_secret := private.safe_vault_secret('conference_speaker_timer_worker_secret');
  RETURN v_secret IS NOT NULL AND p_secret IS NOT NULL AND v_secret = p_secret;
END;
$function$;
