# Recurring meeting delivery

## Current sender deployment

Spark Manager's **Application → Update Internet App** now deploys the frontend,
all Edge Functions and the Spark router from the same fetched `origin/main`
commit on every run, including when the commit has not changed. It discovers the
existing runtime's actual bind mount, preserves its Deno configuration, stages a
complete replacement Functions tree without version/file comparisons, and
restarts only that existing runtime. It runs no frontend or Functions health
probes and makes no HTTP/HTTPS request after installation. Build, copy, activation
or restart errors restore the previous Functions, frontend and source. Database migrations,
runtime images, other workers, schedulers and Offline App updates remain separate.

Existing servers must first use **Manager → Update Manager — Internet**, exit
and reopen `spark` to load this updater. Pulling the repository alone does not
replace the installed Manager modules. The sender-only script below remains a
manual repair option, rather than a required step after Internet App updates.

The database cron now posts `mode: recurring_delivery` to the existing `send-sms`
entrypoint with its dedicated Vault token. The sender verifies that token through
the service-only verifier and permits it only for the server queue-drain mode.
Browser requests retain their user/FULL-session checks and actor/series scoping.
The gateway JWT check is off for `send-sms` because its handler authenticates all
calls, including the non-JWT database scheduler token. Existing Vault URLs ending
in `/meeting-notification-worker` are normalized to `/send-sms`; the token is not
rotated or returned. No separate recurring worker entrypoint is required.

Production evidence showed HTTP 500 `InvalidWorkerCreation` / missing entrypoint,
43 pending jobs and no recorded delivery batch. This was a runtime routing or
installation failure before delivery; it was not evidence of a provider rejection.
The old cron destination had remained on the dedicated worker after immediate
sending had moved to the shared sender. The router also now accepts both
`/functions/v1/SLUG` and `/SLUG` paths so a retained gateway prefix is not mistaken
for a function named `functions`. Existing JWT fail-closed behavior is preserved.

Deploy the sender **before** applying migration
`20261029195736_route_recurring_cron_through_shared_sms.sql` to the target database.
On the Application server, from the repository checkout, run:

```sh
sudo bash deploy/spark-cli/apply-recurring-sms-runtime.sh
```

If the script was copied outside the checkout, pass the complete, updated Spark
source directory explicitly:

```sh
sudo bash /root/apply-recurring-sms-runtime.sh --source-root /path/to/Spark
```

Without that option it checks its repository-relative path, the working directory
and `/opt/spark`. A missing source tree or a sender without scheduler authentication
stops the script before Docker changes or backups. Downloading only this script
does not provide the sender source or its dependencies.

The script discovers the existing Edge Runtime bind mount (or accepts a container
name argument), backs up and copies the router and complete `send-sms` dependency tree, and
restarts only that existing runtime. It restores source files if copying or restart
fails. It does not apply SQL, change credentials, create timers, send a probe or
reset delivery states. After the database migration, normal cron ticks can resume
pending SMS/Bale work through the shared sender. Review the normal queue and
provider reports for actual delivery. The error's disappearance alone is not a
provider delivery receipt. No test, lint or real-recipient probe was run for this
repair. Production runtime changes must be applied on the actual Application node.


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

After deploying both functions and applying the current migration on the target,
open Settings → SMS → Delivery schedule → Recurring meetings and choose
«راه‌اندازی ارسال خودکار در این سامانه». This FULL-session admin command registers
the current HTTPS origin, retains the dedicated Vault token and enables the minute
cron. It activates existing pending work and does not retry uncertain jobs. After
a server/database move, use the same action at the new origin. It does not deploy
Functions or prove provider delivery.

Operators can alternatively configure the HTTPS endpoint as the migration owner. Migration
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

## Split-node SMS transport

Recurring jobs now execute the exported `send-sms/handler.ts` directly inside the
Application worker. Dispatch and external modes also use that same handler for
provider sending. This preserves authentication, FULL-session checks for browser
callers, group/provider rules, templates, timing and the dispatch ledger. Browser
calls still enter through `send-sms/index.ts`; series events remain service-only.

Previously these calls used `client.functions.invoke` or a recursive HTTP call
through `SUPABASE_URL`. Spark renders that URL as the Database gateway, while
Functions are deployed on the Application node. The Database package explicitly
removes the Functions service, so that path cannot deliver in the split topology.
No service key is sent to a URL derived from a browser request by the new path.

Deploy **both** updated functions, including their relative dependencies (the
worker now imports the shared SMS handler). A frontend-only update does not
update Functions or scheduler configuration. The Vault endpoint/token setup above
is still required on the actual target environment; this code change cannot infer
the address of a moved server. Existing uncertain jobs must not be reset.

The connected non-production database still reports `MEETING_WORKER_NOT_CONFIGURED`
and four pending historical jobs. Those were not activated to send to real people.
Production sending is unverified until the target Functions and scheduler are
configured there. Tests cover local transport, internal/external provider routing,
summary templates, receipts, duplicate identity and unknown outcomes without any
provider request to a real recipient.

Split-node validation: 36 targeted Node tests passed, the production build passed,
and the database delivery-readiness rollback suite passed. Both connected test
Functions were redeployed at version 2. No lint, real-recipient SMS, migration or
policy/default change was performed for this transport-only repair.

Repository portability note: concurrent commit `416f9eeda04f9c044335b0ec3df3c12d3f67fcc8`
removed the migration directory. That unrelated deletion is preserved here. The
SQL helper and scheduler definitions mentioned above remain in Git history and
in the connected database; a fresh database cannot receive them from the current
migration directory. Restore a verified migration/baseline source before moving
to an empty database. The transport repair itself changes no database schema.

## Editable recurring templates and runtime setup

Migration `20261028080847_wire_recurring_templates_and_admin_delivery_setup.sql`
adds four in-app templates and replaces only old shipped summary-only/empty SMS
bodies with editable defaults. Existing customized SMS bodies and inactive flags
are preserved. The server now selects an active audience-specific in-app template,
then the active `all` fallback, and stores its rendered title/body and template ID.
Disabling the applicable in-app templates suppresses that channel while SMS policy
continues independently. Historical notifications are not rewritten.

New context fields: `series_start_date`, `series_end_date`, `occurrence_count`,
`series_pattern`, `meeting_time`, `location_part`. The affected occurrence set
controls range/count; reminders still use a single occurrence. Pending historical
jobs also receive the new fields, including cancellation snapshots. Existing
`summary` templates remain valid; both template editors now expose the series
fields and previews. The actual subject reported by the user was absent from the
connected test database, so that database cannot establish the production queue's
state or actual provider delivery.

Validation: four rollback SQL suites passed (template routing/setup, recurring
notifications, series safety, delivery readiness); 40 targeted Node tests and the
production build passed. All four live database SMS templates rendered successfully
against context produced by the live SQL helper without invoking a provider.
The admin setup was tested with real authenticated roles, including nonadmin,
missing session and anon denials, and rolled back. No outbound recipient SMS was
sent, no policy defaults changed, and no lint was run. Worker configuration on the
connected test environment was left inactive rather than draining old pending jobs.

## Invitation wording

The invitation SMS and in-app body use the requested formal wording. The SMS
includes the recipient salutation, subject, actual weekdays, start time, recurrence
frequency and first/last affected dates. The in-app title is «دعوت به جلسات
تکرارشونده» and its body includes the scheduled occurrence count and calendar
confirmation. Change/cancel/reminder templates and delivery policy are unchanged.

`formal_recipient_greeting` uses the stored profile gender (`male`/`female`) for
«جناب آقای»/«سرکار خانم»; an unknown gender receives a neutral greeting. External
recipients without a profile use «همکار گرامی». `series_weekdays` derives all distinct
Tehran weekdays from actual occurrences, including monthly schedules whose dates
fall on different weekdays. `recurrence_frequency` preserves non-unit intervals
(e.g. «هر ۲ هفته»). Both editors expose these fields and sample values.

The invitation opens the existing calendar route. This wording update does not
add series-level accept/decline buttons or a new response workflow. No action
labels are inserted as inert text links. Existing notifications are not rewritten.

Validation: SQL invitation-copy and template-routing suites passed; targeted
renderer/catalog/worker tests and the production build passed. No real SMS was
sent, and scheduler setup was not activated by this copy change.
