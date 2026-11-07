# Bale profile connection

## Confirmed missing runtime token (2026-11-07)

Primary diagnostics confirmed a valid, active `sparkpoushbot` DB configuration, matching registered webhook, HTTP 200 reachability and nine `BALE_BOT_TOKEN not configured` exits, with zero consumed links. The webhook previously required an environment token even when the admin-panel configuration was valid. It now preserves the environment override and, when absent/blank, reads the active Bale channel token using the existing service-role client, consistently with other server-side Bale senders. Disabled, missing or unreadable fallback configuration never consumes a nonce. No credentials are read from incoming updates or returned to callers. Nonce verification, expiry, atomic consume and encrypted mapping remain in the service RPC.

Deploy the updated `supabase/functions/bale-webhook/index.ts` to the existing Functions runtime through the App update, then generate a fresh connection link and open the bot again. No DB migration, token rotation, webhook registration or queue reset is needed. The diagnostic's `container_bale_token_present` may remain false after this fix because the configured DB token is now supported. Its 30-minute error counts include historical failures; compare success counts and nonce use after the new attempt. Automated tests simulate both credentials paths and RPC outcomes without contacting Bale; actual primary activation must be confirmed after rollout.

## A generated link opens the bot but activation remains pending

Link creation is not proof of webhook delivery. Before changing tokens or registering a different webhook, run this read-only check on the Application host (after updating the checkout):

```sh
python3 deploy/spark-cli/diagnose-bale-webhook.py
```

Optional container selectors: `--db-container supabase-db --edge-container supabase-edge-functions`.
The diagnostic keeps DB/container credentials in memory, reads only bot identity and webhook status, sends an empty no-op webhook update to the configured Spark hostname, and reports recent aggregate nonce/log counts. It does not use a connection link, call getUpdates, send a bot message, register/delete a webhook, change DB rows or drop queued updates. It never prints tokens, chat IDs, nonces, raw upstream errors or raw container logs.

Interpret together: an absent webhook URL means registration is missing; a 401/403 response means the public gateway rejected delivery; 404 indicates the route/function is unavailable; different bot usernames indicate configuration mismatch. A missing container `BALE_BOT_TOKEN` together with the matching webhook log marker confirms the handler exits before consuming the nonce. A container environment check alone cannot prove what a separately configured runtime loads. HTTP 200 for the empty probe only proves that empty requests reach a responder; it does not prove account linking. Nonce/log counts cover all users in the last 30 minutes and may not correspond to a single test. Check the current error timestamp as upstream errors may be historical. Primary-server evidence is required; the hosted copy does not receive production bot updates. Do not run `scripts/setup-webhook.sh` for diagnosis: it deletes the existing webhook and requests discarding pending updates.

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

## Repair mixed Vault restore failures without resetting Vault

If the two Bale keys report SQLSTATE 22000 while other Vault entries are a mix of readable and unreadable, first inspect the encrypted Bale mapping/factor counts. When both counts are zero, the new `20261107163952_repair_unreadable_bale_vault_keys_without_ciphertext.sql` migration can recover only the unreadable Bale entries. Healthy Bale keys are preserved. The original encrypted records retain their IDs, ciphertext, nonce and key metadata under `archived_unreadable_...` names; those archival rows intentionally remain unreadable until the original root key is recovered. Other Vault rows are not modified.

Use a database-owner connection, after updating the checkout:

```sh
bash deploy/spark-cli/repair-bale-link-vault.sh --check supabase-db
BALE_REPAIR_DB_USER=supabase_admin bash deploy/spark-cli/repair-bale-link-vault.sh --apply supabase-db
bash deploy/spark-cli/repair-bale-link-vault.sh --check supabase-db
```

`postgres` remains the helper default; `BALE_REPAIR_DB_USER` selects the actual database owner when direct Vault metadata updates are restricted. The recovery does not grant permissions or weaken Vault ownership. If ciphertext appears between diagnosis and execution, table locks and the transactional guard stop the repair with `BALE_KEY_RESTORE_REQUIRED`. Errors roll back the archive and new keys together. Retry is safe. Do not run a Vault reset or rotate the root key to bypass this error. Previously issued broken link tokens should be replaced by clicking Connect again.

The old initialization migration is unchanged. Run this recovery helper before retrying the original initializer on an affected primary. Diagnostics now report each Bale key as OK/MISSING/UNREADABLE without echoing decrypted values or stopping at the first invalid ciphertext.

Validation: the hosted copy permits reading Vault and executing its APIs but restricts direct Vault metadata updates. The migration was applied there with healthy keys and verified not to rotate them; real link nonce generation still passed. Corrupt-row recovery, archival byte preservation, isolation from unrelated corrupt entries, retry and encrypted-data refusal were exercised in a temporary local PostgreSQL model using the exact repair SQL. The model tests metadata/control flow, not production Vault cryptography. The owner-only integration generator is `tests/database/baleVaultRecovery.mjs`; run it only on a disposable/copy database with Vault-owner access. No application or historical migration file was modified by this follow-up, and no lint was run.
