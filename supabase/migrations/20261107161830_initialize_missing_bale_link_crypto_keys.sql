-- Bale link RPCs require two independent Vault secrets. Never rotate an existing key.
DO $migration$
DECLARE v_name text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('spark.bale_link_crypto_keys_v1',0));
 IF to_regclass('vault.decrypted_secrets') IS NULL THEN
  RAISE EXCEPTION 'BALE_VAULT_NOT_AVAILABLE';
 END IF;
 FOREACH v_name IN ARRAY ARRAY['bale_link_hmac_key_v1','bale_chat_encryption_key_v1'] LOOP
  IF EXISTS(SELECT FROM vault.secrets WHERE name=v_name) THEN
   IF NOT EXISTS(SELECT FROM vault.decrypted_secrets WHERE name=v_name AND nullif(decrypted_secret,'') IS NOT NULL) THEN
    RAISE EXCEPTION 'BALE_VAULT_KEY_UNREADABLE: %',v_name;
   END IF;
   CONTINUE;
  END IF;
  -- A missing key with pre-existing ciphertext must be restored, not replaced.
  IF v_name='bale_chat_encryption_key_v1' AND
   (EXISTS(SELECT FROM public.user_bale_mapping WHERE bale_chat_id_enc IS NOT NULL)
    OR EXISTS(SELECT FROM public.custom_mfa_factors WHERE bale_chat_id_enc IS NOT NULL)) THEN
   RAISE EXCEPTION 'BALE_CHAT_KEY_RESTORE_REQUIRED';
  END IF;
  PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),v_name,
   'Spark Bale account linking v1; preserve this key when restoring the database.');
 END LOOP;
END $migration$;
