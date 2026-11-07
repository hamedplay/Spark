-- Readiness only: never print bot tokens, Vault values, chat IDs or nonces.
\set ON_ERROR_STOP on
\pset pager off
SELECT current_user AS database_user,has_table_privilege(current_user,'vault.secrets','UPDATE') AS can_repair_vault;
SELECT to_regprocedure('public.create_bale_link_nonce_service(uuid)') IS NOT NULL AS link_rpc_present,
 to_regprocedure('public.consume_bale_link_nonce_service(text,text)') IS NOT NULL AS consume_rpc_present;
DO $check$
DECLARE v_name text; r record; v_status text; v_found boolean;
BEGIN
 FOREACH v_name IN ARRAY ARRAY['bale_link_hmac_key_v1','bale_chat_encryption_key_v1'] LOOP
  v_found:=false;
  FOR r IN SELECT id FROM vault.secrets WHERE name=v_name LOOP
   v_found:=true;
   BEGIN
    SELECT CASE WHEN nullif(decrypted_secret,'') IS NOT NULL THEN 'OK' ELSE 'EMPTY' END
     INTO v_status FROM vault.decrypted_secrets WHERE id=r.id;
   EXCEPTION WHEN OTHERS THEN v_status:='UNREADABLE ('||SQLSTATE||')';
   END;
   RAISE NOTICE 'Bale key %: %',v_name,v_status;
  END LOOP;
  IF NOT v_found THEN RAISE NOTICE 'Bale key %: MISSING',v_name; END IF;
 END LOOP;
END $check$;
SELECT is_active AS channel_active,
 coalesce(btrim(bot_username),'') ~ '^@?[A-Za-z0-9_]{3,32}$' AS bot_username_valid
FROM public.social_channel_configs WHERE channel='bale';
SELECT count(*) FILTER(WHERE bale_chat_id_enc IS NOT NULL) AS encrypted_mappings FROM public.user_bale_mapping;
SELECT count(*) FILTER(WHERE bale_chat_id_enc IS NOT NULL) AS encrypted_mfa_factors FROM public.custom_mfa_factors;
