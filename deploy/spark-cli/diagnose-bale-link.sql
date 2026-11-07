-- Readiness only: never print bot tokens, Vault values, chat IDs or nonces.
\set ON_ERROR_STOP on
\pset pager off
SELECT to_regprocedure('public.create_bale_link_nonce_service(uuid)') IS NOT NULL AS link_rpc_present,
 to_regprocedure('public.consume_bale_link_nonce_service(text,text)') IS NOT NULL AS consume_rpc_present;
SELECT exists(SELECT FROM vault.decrypted_secrets WHERE name='bale_link_hmac_key_v1' AND nullif(decrypted_secret,'') IS NOT NULL) AS link_key_ready,
 exists(SELECT FROM vault.decrypted_secrets WHERE name='bale_chat_encryption_key_v1' AND nullif(decrypted_secret,'') IS NOT NULL) AS chat_key_ready;
SELECT is_active AS channel_active,
 coalesce(btrim(bot_username),'') ~ '^@?[A-Za-z0-9_]{3,32}$' AS bot_username_valid
FROM public.social_channel_configs WHERE channel='bale';
SELECT count(*) FILTER(WHERE bale_chat_id_enc IS NOT NULL) AS encrypted_mappings FROM public.user_bale_mapping;
SELECT count(*) FILTER(WHERE bale_chat_id_enc IS NOT NULL) AS encrypted_mfa_factors FROM public.custom_mfa_factors;
