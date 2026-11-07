-- Real crypto/RPC integration. No HTTP, bot messages, or data is committed.
BEGIN;
DO $test$
DECLARE u uuid; n jsonb; r jsonb; hash text; nonce text;
BEGIN
 SELECT id INTO u FROM auth.users LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_USER'; END IF;
 n:=public.create_bale_link_nonce_service(u);
 nonce:=n->>'nonce';
 IF (n->>'ok')::boolean IS DISTINCT FROM true OR nonce !~ '^[0-9a-f]{64}$'
  OR (n->>'expires_at')::timestamptz <= now() THEN RAISE EXCEPTION 'LINK_GENERATION_FAILED'; END IF;
 hash:=private.bale_link_hmac_v1(nonce,'bale_link');
 IF NOT EXISTS(SELECT FROM public.bale_link_nonces WHERE nonce_hash=hash AND nonce_hash<>nonce AND used_at IS NULL) THEN
  RAISE EXCEPTION 'NONCE_NOT_HASHED'; END IF;
 r:=public.consume_bale_link_nonce_service(nonce,'-900000000000000001');
 IF (r->>'ok')::boolean IS DISTINCT FROM true OR (r->>'user_id')::uuid<>u THEN RAISE EXCEPTION 'LINK_CONSUME_FAILED'; END IF;
 IF NOT EXISTS(SELECT FROM public.user_bale_mapping WHERE user_id=u AND bale_chat_id_enc IS NOT NULL
  AND private.bale_chat_decrypt_v1(bale_chat_id_enc)='-900000000000000001'
  AND bale_chat_id_hmac=private.bale_link_hmac_v1('-900000000000000001','bale_chat_id')) THEN
  RAISE EXCEPTION 'MAPPING_CRYPTO_FAILED'; END IF;
 r:=public.consume_bale_link_nonce_service(nonce,'-900000000000000002');
 IF (r->>'ok')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'NONCE_REPLAY_ALLOWED'; END IF;
 n:=public.create_bale_link_nonce_service(u);
 UPDATE public.bale_link_nonces SET expires_at=now()-interval '1 minute'
 WHERE nonce_hash=private.bale_link_hmac_v1(n->>'nonce','bale_link');
 r:=public.consume_bale_link_nonce_service(n->>'nonce','-900000000000000002');
 IF (r->>'ok')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'EXPIRED_NONCE_ALLOWED'; END IF;
 IF has_function_privilege('anon','public.create_bale_link_nonce_service(uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.create_bale_link_nonce_service(uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.consume_bale_link_nonce_service(text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'SERVICE_LINK_RPC_EXPOSED'; END IF;
END $test$;
ROLLBACK;
SELECT 'bale_link_connection_integration_passed' AS result;
