# Bale profile connection

The profile calls `bale-link-generate`, which validates the user's FULL session and asks `create_bale_link_nonce_service` for a one-time token. The RPC HMACs the token using `bale_link_hmac_key_v1` in Vault. `bale-webhook` consumes it once and uses the separate `bale_chat_encryption_key_v1` to encrypt the chat mapping.

The connected copy reproduced `BALE_LINK_HMAC_KEY_NOT_CONFIGURED`; both required Vault keys were absent while the Bale channel was active and its username valid. The Edge Function collapsed that configuration failure into a generic HTTP 500. The production screenshot shows the same failed endpoint; production Vault state must be checked on that server rather than inferred from the copy.

The new migration initializes only absent keys with independent 32-byte random values inside Vault. An advisory transaction lock prevents duplicate initialization. Existing keys, account mappings and pending nonces are not overwritten or deleted. If a key cannot be decrypted, or a missing encryption key has pre-existing ciphertext, setup fails explicitly: restore the original Vault key rather than generate a replacement. Vault state and its encryption material must be included in database recovery procedures. No secret, nonce or chat ID is printed by the rollout diagnostics.

The endpoint reports missing crypto/database setup as an actionable 503 with a stable error code; unexpected failures remain failures. Authentication and service-only RPC execution remain enforced. The client opens the destination window during the click gesture before awaiting the server, detaches its opener, closes unused windows on failure, and retains an explicit HTTPS `ble.ir` link if popups are blocked. Polling stops and re-enables retry after its existing two-minute limit.

## Self-hosted rollout

After updating the checkout, run on the database host:

```sh
bash deploy/spark-cli/apply-bale-link-crypto.sh --check supabase-db
bash deploy/spark-cli/apply-bale-link-crypto.sh --apply supabase-db
bash deploy/spark-cli/apply-bale-link-crypto.sh --check supabase-db
```

The apply helper executes only `20261107161830_initialize_missing_bale_link_crypto_keys.sql` and records it in migration history. Repeating it safely rechecks initialization without rotating existing keys. No old migration is edited. Deploy the matching frontend and `bale-link-generate` function on the Application node. The existing bot webhook URL and bot token are not changed by this fix.

## Validation

- Actual database RPC integration: 64-character one-time token generation, HMAC-only lookup, consume and encrypted mapping, rejection of token replay/expiry and service-only execution. All fixtures roll back; no bot message is sent.
- Re-running initialization preserves the existing HMAC key.
- Nine focused endpoint/click-flow tests cover successful links, configuration failures, authorization, disabled channels, blocked popups, server errors and invalid destinations.
- The production build passed against starting main `91fa949`; shell syntax and all Bale tests passed. While integrating concurrent upstream changes, build on `5026863`/`60c4982` was blocked by an existing adjacent-JSX error in `src/features/meetings/components/CreateMeetingForm/AgendaEditor.tsx:206`. That unrelated file was left unchanged. No lint was run.
- The connected copy has the new migration and the link function deployed. Real browser-to-bot webhook completion on the primary deployment remains a rollout check.
