# Application live data

Database writes emit private `app-data-changes` / `data_changed` broadcasts through
statement-level triggers. The application payload contains only the table name;
Realtime may add its own message identifier. It contains no affected row identifier,
recipient or document content. Only fully authorized sessions can receive this topic;
there is no client INSERT policy for it. All actual reads retain table/RPC RLS.

`LIVE_DATA` maps tables to mounted readers. One shared socket invalidates relevant
readers; directory/permission changes invalidate all readers because their joins and
access can change. Events coalesce for 100 ms and refreshes are serialized with a
trailing refresh for changes received during a request. Existing chat, notifications
and conference collaboration subscriptions continue to handle their specific streams.
Heartbeat/presence/session tables are deliberately excluded from global invalidation.

Readers reconcile after subscription/reconnection, online/focus/visibility resume,
and every 60 seconds as recovery from missed events (15 seconds while the socket is
unavailable). Hidden tabs defer event refreshes until visible. These recovery timers
are not the primary delivery mechanism. Closing the last reader removes the socket,
listeners and timer. Failed initial authentication retries on resume/fallback.

Lists retain filters/pagination and the calendar retains its viewport. Quiet reloads
do not replace whole screens with loading placeholders. Open meeting/decision/task
read views and dependent read models update as well. Editors retain unsaved drafts;
pristine settings forms accept external changes. Explicit save/export/send/provider
connection tests remain user actions. External provider state without a database
write is not a database Realtime event.

## Deployment

Apply these new migrations in order to the destination database, then deploy the
frontend from the same commit:

- `20261026223606_shared_live_data_invalidation.sql`
- `20261026224425_channel_read_state_live_invalidation.sql`
- `20261026225136_remaining_live_readers_invalidation.sql`

They were applied to the connected **test** project, not the production database.
Adding a reader for a new table requires a new migration adding its statement trigger
and adding that table to the appropriate scope. Do not edit applied migrations.

## Validation performed

- Build passed; lint was not run.
- `node --import tsx --test tests/realtime/liveData.test.ts` covers coalescing,
  in-flight changes, disposal, failure recovery, routing, one shared channel,
  permissions invalidation, visibility, reconnection and initial authentication retry.
- Recurrence and decision conversion regression tests passed.
- Live test: two authenticated devices of one temporary user plus another fully
  authorized temporary user joined the private topic. Zero-row UPDATE statements
  exercised the statement triggers on meetings, meeting_inbox, minutes and
  minutes_decisions without changing business records; all three received all four
  signals. A temporary private note was inserted/deleted using the authenticated
  client; another user's SELECT returned no rows. Anonymous subscription and client
  publication were rejected. Temporary users, sessions and note were removed and
  verified absent. This verifies transport/RLS, not every screen on a physical device.
- Explicit application TypeScript checking still reports existing repository errors;
  comparison with unchanged main introduced no diagnostics.
- An existing notificationModel test (`uses only action URL for rich-toast navigation`)
  fails identically on unchanged main. Notification navigation was not changed here.
