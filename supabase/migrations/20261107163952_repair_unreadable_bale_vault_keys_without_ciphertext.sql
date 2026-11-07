-- Scoped recovery after a restore with mixed readable/unreadable Vault rows.
-- Old ciphertext is retained under an archival name. No healthy key is rotated.
DO $repair$
DECLARE v_name text; r record; v_readable boolean; v_has_readable boolean;
 v_bad_ids uuid[]; v_id uuid; v_new_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('spark.bale_link_crypto_keys_v1',0));
 LOCK TABLE public.user_bale_mapping,public.custom_mfa_factors IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE vault.secrets IN SHARE ROW EXCLUSIVE MODE;
 FOREACH v_name IN ARRAY ARRAY['bale_link_hmac_key_v1','bale_chat_encryption_key_v1'] LOOP
  v_bad_ids:='{}'; v_has_readable:=false;
  FOR r IN SELECT id FROM vault.secrets WHERE name=v_name ORDER BY id LOOP
   BEGIN
    -- Decryption belongs in the target list, after the ID filter, not in WHERE.
    SELECT nullif(decrypted_secret,'') IS NOT NULL INTO v_readable
     FROM vault.decrypted_secrets WHERE id=r.id;
   EXCEPTION WHEN data_exception THEN
    v_readable:=false;
   END;
   IF v_readable IS TRUE THEN v_has_readable:=true;
   ELSE v_bad_ids:=array_append(v_bad_ids,r.id);
   END IF;
  END LOOP;
  IF v_has_readable AND cardinality(v_bad_ids)=0 THEN CONTINUE; END IF;
  -- Fail closed if historical encrypted Bale data could depend on the old material.
  IF EXISTS(SELECT FROM public.user_bale_mapping WHERE bale_chat_id_enc IS NOT NULL)
   OR EXISTS(SELECT FROM public.custom_mfa_factors WHERE bale_chat_id_enc IS NOT NULL) THEN
   RAISE EXCEPTION 'BALE_KEY_RESTORE_REQUIRED: encrypted Bale data exists; restore original keys';
  END IF;
  IF cardinality(v_bad_ids)>0 AND NOT has_table_privilege(current_user,'vault.secrets','UPDATE') THEN
   RAISE EXCEPTION 'BALE_VAULT_REPAIR_REQUIRES_DATABASE_OWNER';
  END IF;
  FOREACH v_id IN ARRAY v_bad_ids LOOP
   -- Updating Vault metadata directly avoids re-encrypting the unreadable value.
   UPDATE vault.secrets SET name='archived_unreadable_'||v_name||'_'||id::text,
    description=description||E'\nArchived by scoped Bale recovery; encrypted value preserved.',updated_at=now()
   WHERE id=v_id AND name=v_name;
  END LOOP;
  IF NOT v_has_readable THEN
   v_new_id:=vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),v_name,
    'Spark Bale linking recovery; original unreadable ciphertext retained.');
   SELECT nullif(decrypted_secret,'') IS NOT NULL INTO v_readable
    FROM vault.decrypted_secrets WHERE id=v_new_id;
   IF v_readable IS DISTINCT FROM true THEN RAISE EXCEPTION 'BALE_NEW_VAULT_KEY_NOT_READABLE'; END IF;
  END IF;
 END LOOP;
END $repair$;
