# Recurring meeting delivery

New series use `meetings.series_id`. Existing occurrences stay unlinked: titles,
creator names and close creation timestamps are not proof of series identity.
Calendar bulk edit/delete requires a known series; an old unlinked occurrence
can still be edited/deleted individually.

`create_meeting_series` is an authenticated, FULL-session command. It commits
all occurrences, inbox invitations, participant snapshots, agenda copies and
notification events in one transaction. Its caller-generated UUID and request
hash make retrying the same submission idempotent. Different data with the same
operation UUID is rejected. Maximum size: 600 occurrences. Both creation forms
use this command. Unscheduled requests do not send calendar invitations until
scheduled.

Statement triggers classify invite/change/cancel by comparing recipient sets.
Roles are deduplicated by user; external contacts by normalized phone. An external
contact matching an internal recipient's phone is suppressed. Only genuine
schedule/location/subject/online-room changes alert retained recipients. Date
comparisons use the Tehran calendar day, not legacy timestamp components.
A bulk statement produces one summary per event and recipient. Added recipients
receive invitations without re-inviting existing people. Deletion retains its
snapshot in the private delivery queue; jobs do not cascade away with meetings.

Policy: Settings → SMS → Delivery schedule → Recurring meetings. Admin-only RPCs
control internal invitations, SMS invitations, important changes/cancellations,
internal reminders, internal-user SMS reminders and external SMS reminders.
Invitation and important-change channels default on; reminder SMS defaults off.
External SMS also requires the existing per-meeting external-SMS opt-in.
Explicit calendar “save without informing” is preserved by an atomic update RPC.
SMS templates `series_invite/change/cancel/reminder` use `{{summary}}` and remain
editable in the existing template manager. SMS timing windows still apply.

A database cron tick runs every minute. It materializes due reminders (1–10080
minutes before start), excluding pending/declined invitations; repeated ticks
cannot duplicate the same scheduled reminder. It uses server Tehran time and
works without an open calendar. Old unlinked meetings retain their prior browser
reminder path. Internal records feed the existing Realtime and Push bridge.

`meeting-notification-worker` uses its own Vault token and a service-only verifier;
its gateway JWT check is off because pg_net authenticates via that token. The
worker's database/SMS calls still require the normal service-role credential.
Claims use row locks and leases. SMS identity is passed through to send-sms's
existing dispatch ledger. A delivery-policy postponement is safe to retry before
provider invocation. Unknown delivery outcomes and expired processing leases are
marked `uncertain` for review, never blindly resent. Queue cleanup retains unknown
outcomes and retains ordinary job identities until affected dates pass (90-day
minimum). Series request identities are retained separately.

## Deployment and validation

Apply pending migrations with the repository migration runner; do not edit previous
migrations. Deploy `send-sms` and `meeting-notification-worker`, and publish the frontend.
The worker's gateway JWT verification is off because its body verifies the dedicated
Vault token; `send-sms` retains its gateway and in-function authorization.

After deploying both functions on the actual target environment, configure its own
HTTPS endpoint as the migration owner. Migration
`20261028060706_repair_recurring_delivery_snapshots_and_readiness.sql` provides an
idempotent operator-only helper:

```sql
select private.configure_meeting_notification_worker(
  'https://YOUR_API_HOST/functions/v1/meeting-notification-worker'
);
```

This generates the dedicated token inside Vault when missing, retains a valid existing
token, and updates the URL without returning secrets. It is unavailable to browser and
service-role callers. Run it for the current host after a database move, rather than
copying old URLs or manually reconstructing secrets. It does not deploy functions or
configure the SMS provider, group rules or provider credentials.

Configuring the endpoint enables cron to process existing pending jobs. Review that
queue on the target environment first; do not reset uncertain deliveries for a test.
The admin panel now shows scheduler configuration, heartbeat and queue status counts.
Configuration presence alone does not prove provider delivery. Missing setup is shown
explicitly instead of making a saved policy look like a working sender.
Do not put a provider key, a service-role JWT or the Vault token in frontend code.

SQL integration tests roll back every fixture and outbound job:
- `tests/database/recurringMeetingNotifications.sql`: 52 occurrences, 520 inbox
  invitations, recipient aggregation, adding a member, single occurrence changes,
  silent edits, server reminders, leases/acknowledgement, ownership and deletion.
- `tests/database/recurringMeetingSeriesSafety.sql`: normalized external numbers,
  internal/external overlap, atomic failure recovery, same-title series separation,
  same-local-day timestamps, worker-only RPC permissions.

Node tests cover atomic frontend routing, unchanged legacy editing, recurrence
builders, worker delivery/defer/unknown outcomes and creation failure handling.
No real recipient is messaged by tests.

During an earlier probe this test project returned `PGRST303: JWT issued at future`.
That error was not reproduced in the current safe HTTP verification probe: after
deploying both functions, the worker returned 401 without a token and 403 for an
invalid token. These checks invoke no provider and do not claim delivery jobs.
The current test environment initially had no deployed Edge Functions, no Vault
worker configuration and four pending jobs, with MEETING_WORKER_NOT_CONFIGURED.
Functions were deployed for validation; live queue activation was deliberately not
performed, and no real recipient was messaged. Production runtime/configuration
must be verified separately on the actual server.

The same investigation found 242 legacy recurring occurrences without series_id and
no linked series in the test data. Their titles/timestamps are not a safe identity;
they were not merged or backfilled. Create new linked series through the atomic RPC
or supply an explicit, verified mapping for any later legacy migration.

The new delivery-readiness SQL regression checks that claiming a partially invalidated
series rebuilds summary text and occurrence_count from valid occurrences, preserves
the original pattern, handles equivalent Tehran date encodings, retains cancellation
history and never reclaims an uncertain lease. Worker tests also cover uncertain
provider transport and pending-ledger responses. See
`tests/database/recurringDeliveryReadiness.sql` and
`tests/meetings/recurringNotificationWorker.test.ts`.

Validation for this repair: the new delivery-readiness SQL suite plus the existing
recurring notification, series safety and scheduler-readiness SQL suites passed.
The 52-occurrence/520-invitation assertions, new-member-only routing, affected
occurrence changes, cancellation, per-occurrence server reminders and reminder-SMS
defaults remain covered. All 21 targeted worker/recurrence/dispatch code tests and
the production build passed. Both deployed test functions are ACTIVE; safe HTTP
checks returned worker 401/403 and send-sms 401. The four pre-existing pending jobs
and empty Vault were retained. No delivery to a real recipient was attempted.
No lint or PR was run/created.

Operational diagnosis (run with privileged database tooling):
```sql
select status, count(*) from private.meeting_notification_jobs group by status;
select jobname, active from cron.job
where jobname='spark-recurring-meeting-notifications';
select status, return_message, start_time from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='spark-recurring-meeting-notifications')
order by start_time desc limit 10;
```
Inspect `uncertain` deliveries against provider receipts before any manual retry.
