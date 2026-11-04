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

The apply command records both new migrations in history and sets the worker URL in one transaction. It is safe to run again after an upgrade. It never prints the worker token. `pg_cron`, `pg_net`, `pgcrypto`, the existing notes/notifications schema, and the base reminder migration are prerequisites.

The `spark-note-reminders` job runs once a minute. Inspect `private.note_reminder_worker_config` for `last_tick_at` and `last_error`, without exposing `worker_token`. Inspect `private.note_reminder_deliveries` for per-recipient/channel outcomes; existing SMS provider logs remain in `sms_dispatch_logs`.

Do not test by sending another user's private note to a real external account. Use transport mocks or an isolated database for integration tests.
