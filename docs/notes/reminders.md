# Note reminder delivery

The owner and up to 20 selected active users in the same organization receive the note title and complete text. Selecting recipients does not grant access to the owner's private notes. Each recipient gets their own in-app notification; SMS follows the existing `note` category provider/group rules and timing policy. Bale delivery requires an active bot and a linked account.

Each SMS and Bale delivery has a separate durable ledger entry. SMS uses a stable dispatch key; an ambiguous provider response is retained as `uncertain` and is not automatically resent. Long Bale messages are split into ordered parts without dropping text. Changing or removing a schedule, removing a recipient, archiving or deleting a note cancels unclaimed deliveries. An already in-flight external request cannot be recalled.

## Self-hosted rollout

1. Apply the base reminder migration `20261104051915_add_note_reminders.sql` if it has not already been installed.
2. Deploy `supabase/functions/note-reminder-worker` together with its relative dependencies and its `config.toml` entry on the Application node. It verifies a dedicated database-generated token before claiming any work. No token belongs in the frontend or in this repository.
3. Apply the new migrations and configure the HTTPS **Application** URL, where Edge Functions actually run:

```sh
bash deploy/spark-cli/apply-note-reminder-delivery.sh --check supabase-db
bash deploy/spark-cli/apply-note-reminder-delivery.sh --apply supabase-db https://YOUR-APPLICATION/functions/v1/note-reminder-worker
```

The apply command records the new migrations in history and sets the worker URL in one transaction. It is safe to run again after an upgrade. It never prints the worker token. `pg_cron`, `pg_net`, `pgcrypto`, the existing notes/notifications schema, and the base reminder migration are prerequisites.

The `spark-note-reminders` job runs once a minute. Inspect `private.note_reminder_worker_config` for `last_tick_at` and `last_error`, without exposing `worker_token`. Inspect `private.note_reminder_deliveries` for per-recipient/channel outcomes; existing SMS provider logs remain in `sms_dispatch_logs`.

Do not test by sending another user's private note to a real external account. Use transport mocks or an isolated database for integration tests.

## Delivery diagnostics

Open the bell button beside the note date/time to see each selected user's SMS and Bale status. Missing phone numbers, disabled SMS group rules and unlinked Bale accounts are shown separately. Older reminders that only created an in-app notification are identified explicitly; choose a new future time to send them through the new channels.

The deployment script probes the Application worker before accepting its URL. A worker 404, generic JWT-gateway 401, or 5xx fails setup. The database scheduler records the asynchronous HTTP response on its next tick instead of clearing errors merely because pg_net accepted the request.

For diagnosis on the primary server, run `bash deploy/spark-cli/apply-note-reminder-delivery.sh --check supabase-db`. The output contains the configured worker URL, scheduler timestamp, last error, channel status counts and diagnostic-function availability; it does not print tokens, phone numbers or note contents.

### Recipient search and production delivery diagnostics

Recipient search now displays selectable matching users immediately beneath the search field, instead of silently filtering a closed native select. It normalizes Arabic/Persian kaf and yeh, diacritics and half-spaces, excludes selected recipients and shows explicit loading/empty states. Existing same-organization server eligibility and the twenty-recipient limit remain unchanged.

Readiness failures now show the known server reason (missing configuration, scheduler, HTTP authorization/route or network/timeout). An unrecognized raw error is not echoed into the UI. A healthy copy with an empty delivery queue cannot establish why production delivery failed.

Run from the updated checkout on the real database host and share the output:

```sh
docker exec -i supabase-db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < deploy/spark-cli/diagnose-note-reminders.sql
```

This file only reads schema availability, cron state, whitelisted worker configuration, the latest worker HTTP status, grouped delivery errors and overdue counts. It does not print worker tokens, note bodies, phone numbers or bot credentials, and does not retry deliveries. Missing optional objects are reported without referencing absent relations.

## Sender identity and standard messages

Apply the new `20261107060240_note_sender_identity_and_message_privacy.sql` and `20261107061409_preserve_note_sender_snapshots_on_account_deletion.sql` migrations on the existing notes database, then deploy the matching frontend and `note-reminder-worker`. On a self-hosted installation:

```sh
bash deploy/spark-cli/apply-note-message-identity.sh --check supabase-db
bash deploy/spark-cli/apply-note-message-identity.sh --apply supabase-db
```

Sharing now uses `share_note_v2(note_id, recipient_id)`: the database verifies ownership and organization eligibility, copies the note with the authenticated sender's identity, creates the in-app notification and queues SMS/Bale atomically. The old text-only share API fails with an explicit reload message because it cannot verify the source note's privacy policy. Updated clients do not create a second notification or send another SMS themselves.

New notes retain a server-assigned creator/name snapshot. Scheduling captures the reminder creator separately, so a recipient scheduling a shared copy is identified correctly. Editing content or service delivery does not replace either identity. Old shared notes have no recoverable sender attribution; details explicitly show that it was not recorded instead of inventing one. Previously sent notifications/messages are not rewritten or resent.

Both ordinary-note and reminder messages identify the sender and include the complete note text. Reminders include a Jalali date and 24-hour clock in Asia/Tehran. The note details and note notification details show the sender, recipient(s), registration date and reminder time. Recipient lists are shown only to the note owner; a reminder recipient can inspect only their own recipient identity.

The privacy checkbox suppresses both title and body from SMS/Bale and sends a generic instruction to view the secure in-app notification instead. Sharing inherits this flag. The worker retrieves an authorized envelope immediately before each external request, rechecking current eligibility, lease, schedule and privacy. No envelope means no external send. SMS still follows existing group/provider/timing rules and retains the stable dispatch key. Multipart Bale delivery retains the full allowed text. Unknown provider outcomes retain the existing no-automatic-resend behavior. Restricting a queued multipart note emits at most one redacted message and skips the remaining parts. A request already in flight cannot be recalled.
