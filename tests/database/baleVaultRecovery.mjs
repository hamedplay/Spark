// Generate a rollback-only integration test for psql / the connected copy.
// No credentials or decrypted values are printed. Run: node this-file | psql ...
import { readFileSync } from 'node:fs';
const repair = readFileSync(new URL('../../supabase/migrations/20261107163952_repair_unreadable_bale_vault_keys_without_ciphertext.sql',import.meta.url),'utf8');
const model = process.argv.includes('--model');
const quote = value => "'"+value.replaceAll("'","''")+"'";
process.stdout.write(`BEGIN;
SET LOCAL lock_timeout='5s';
DO $before$
BEGIN
 IF NOT has_table_privilege(current_user,'vault.secrets','UPDATE') THEN RAISE EXCEPTION 'TEST_REQUIRES_VAULT_OWNER'; END IF;
 IF EXISTS(SELECT FROM public.user_bale_mapping WHERE bale_chat_id_enc IS NOT NULL)
 OR EXISTS(SELECT FROM public.custom_mfa_factors WHERE bale_chat_id_enc IS NOT NULL) THEN
  RAISE EXCEPTION 'TEST_REQUIRES_COPY_WITHOUT_ENCRYPTED_BALE_FIXTURES';
 END IF;
 PERFORM set_config('test.vault_before',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM vault.secrets s),true);
END $before$;
${repair}
DO $fixtures$
DECLARE v_id uuid; v_bad_ids uuid[]:='{}';
BEGIN
 IF current_setting('test.vault_before')::jsonb IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM vault.secrets s) THEN
  RAISE EXCEPTION 'HEALTHY_KEYS_CHANGED'; END IF;
 UPDATE vault.secrets SET name='test_original_'||id::text
 WHERE name IN('bale_link_hmac_key_v1','bale_chat_encryption_key_v1');
 INSERT INTO vault.secrets(name,secret) VALUES('bale_link_hmac_key_v1',encode(extensions.gen_random_bytes(32),'base64')) RETURNING id INTO v_id;
 v_bad_ids:=array_append(v_bad_ids,v_id);
 INSERT INTO vault.secrets(name,secret) VALUES('bale_chat_encryption_key_v1',encode(extensions.gen_random_bytes(32),'base64')) RETURNING id INTO v_id;
 v_bad_ids:=array_append(v_bad_ids,v_id);
 INSERT INTO vault.secrets(name,secret) VALUES('test_unrelated_corrupt_'||gen_random_uuid()::text,encode(extensions.gen_random_bytes(32),'base64'));
 PERFORM set_config('test.bad_ids',v_bad_ids::text,true);
 PERFORM set_config('test.bad_cipher',(SELECT jsonb_agg(jsonb_build_object('id',id,'secret',secret,'nonce',nonce,'key_id',key_id) ORDER BY id)::text FROM vault.secrets WHERE id=ANY(v_bad_ids)),true);
 PERFORM set_config('test.other_rows',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM vault.secrets s WHERE id<>ALL(v_bad_ids)),true);
END $fixtures$;
${repair}
DO $assert_recovery$
DECLARE r record; v_readable boolean; v_bad_ids uuid[]:=current_setting('test.bad_ids')::uuid[]; v_nonce jsonb;
BEGIN
 IF (SELECT count(*) FROM vault.secrets WHERE id=ANY(v_bad_ids) AND name LIKE 'archived_unreadable_%')<>2 THEN
  RAISE EXCEPTION 'UNREADABLE_CIPHERTEXT_NOT_ARCHIVED'; END IF;
 IF current_setting('test.bad_cipher')::jsonb IS DISTINCT FROM
 (SELECT jsonb_agg(jsonb_build_object('id',id,'secret',secret,'nonce',nonce,'key_id',key_id) ORDER BY id) FROM vault.secrets WHERE id=ANY(v_bad_ids)) THEN
  RAISE EXCEPTION 'ORIGINAL_CIPHERTEXT_CHANGED'; END IF;
 IF current_setting('test.other_rows')::jsonb IS DISTINCT FROM
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM vault.secrets s
 WHERE id<>ALL(v_bad_ids) AND name NOT IN('bale_link_hmac_key_v1','bale_chat_encryption_key_v1')) THEN
  RAISE EXCEPTION 'UNRELATED_VAULT_ENTRY_CHANGED'; END IF;
 FOR r IN SELECT id FROM vault.secrets WHERE name IN('bale_link_hmac_key_v1','bale_chat_encryption_key_v1') LOOP
  SELECT nullif(decrypted_secret,'') IS NOT NULL INTO v_readable FROM vault.decrypted_secrets WHERE id=r.id;
  IF NOT v_readable THEN RAISE EXCEPTION 'REPLACEMENT_NOT_READABLE'; END IF;
 END LOOP;
 ${model ? '' : `v_nonce:=public.create_bale_link_nonce_service((SELECT id FROM auth.users LIMIT 1));
 IF (v_nonce->>'nonce') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'LINK_STILL_BROKEN'; END IF;`}
 PERFORM set_config('test.repaired_snapshot',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM vault.secrets s),true);
END $assert_recovery$;
${repair}
DO $guard$
DECLARE v_user uuid;
BEGIN
 IF current_setting('test.repaired_snapshot')::jsonb IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM vault.secrets s) THEN
  RAISE EXCEPTION 'REPAIR_NOT_IDEMPOTENT'; END IF;
 SELECT id INTO v_user FROM auth.users LIMIT 1;
 INSERT INTO public.user_bale_mapping(user_id,bale_chat_id,bale_chat_id_enc)
 VALUES(v_user,'-900000000000000001',decode('deadbeef','hex'))
 ON CONFLICT(user_id) DO UPDATE SET bale_chat_id_enc=excluded.bale_chat_id_enc;
 UPDATE vault.secrets SET name='test_guard_original_'||id::text WHERE name='bale_link_hmac_key_v1';
 INSERT INTO vault.secrets(name,secret) VALUES('bale_link_hmac_key_v1',encode(extensions.gen_random_bytes(32),'base64'));
 PERFORM set_config('test.guard_snapshot',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM vault.secrets s),true);
 BEGIN
  EXECUTE ${quote(repair)};
  RAISE EXCEPTION 'ENCRYPTED_DATA_GUARD_NOT_ENFORCED';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM NOT LIKE 'BALE_KEY_RESTORE_REQUIRED:%' THEN RAISE; END IF;
 END;
 IF current_setting('test.guard_snapshot')::jsonb IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM vault.secrets s) THEN
  RAISE EXCEPTION 'REFUSED_REPAIR_CHANGED_VAULT'; END IF;
END $guard$;
ROLLBACK;
SELECT '${model ? 'bale_vault_recovery_model_passed' : 'bale_vault_recovery_integration_passed'}' AS result;
`);
