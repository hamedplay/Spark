# Database audit repairs and transfer contract

Apply the new migration files using the normal Spark database migration runner,
then deploy the frontend and the updated `send-daily-meetings` Edge Function.
The runner checks individual version identities, including gaps in restored history.

## Changes

- `fix_security_audit_pagination`: repair v2's stale role lookup and aggregate
  pagination; require a FULL active session and an active admin/security-admin.
  Preserve the flat event response, add a stable keyset cursor, sanitize metadata.
- `align_security_audit_session_gate`: use the canonical v3 session evaluator,
  including temporary account locks as well as revoked/expired sessions.
- `repair_meeting_relations_and_counters`: archive existing orphan inbox rows and
  broken calendar pointers in `private.database_integrity_repair_archive` before
  repairing them. Make inbox meeting references mandatory/cascading; calendar
  references use SET NULL. Validate the existing account-state constraint.
  Replace the two member-count triggers with one atomic insert/delete/move trigger;
  remove the redundant channel timestamp trigger and inbox partial unique index.
- `restore_meeting_scheduler_and_local_dates`: retain `request_date` unchanged and
  add indexed generated `request_local_date`, interpreted as the Tehran day.
  Calendar/range/report queries use this column, so date-only and timestamp rows
  share the same filtering contract. Restore reminder/retention cron jobs. Store
  scheduler readiness separately so missing SMS configuration cannot roll back
  in-app reminders. `requested` means an HTTP dispatch was queued, not delivered.
- `optimize_rls_identity_and_hot_foreign_keys`: evaluate zero-argument identity
  functions through scalar SELECTs. Never change role sets, policy modes, names or
  command coverage, nor rewrite SQL string literals. Add only covering indexes
  for observed parent lookup paths. Keep unused indexes and overlapping policies
  whose removal would need workload or authorization evidence.

The frontend calendar creation path now uses `archived / scheduled`, matching the
existing calendar form. Later series occurrences inherit the same lifecycle.
`closed` continues to mean excluded from the current calendar workflow; genuinely
closed meetings are not resurrected. Historical timestamps are not bulk rewritten.

## External dependencies

The connected non-production project has no Edge Functions and no Vault secrets.
The database migrations cannot recreate a provider credential or verify external
SMS delivery. Deploy `meeting-notification-worker` and its normal SMS dependencies;
configure `meeting_notification_worker_url` and `meeting_notification_worker_token`
through the existing Vault procedure, keeping them out of migrations and Git.

Until then the reminder tick records `blocked / MEETING_WORKER_NOT_CONFIGURED` in
`private.meeting_scheduler_state`; it still commits in-app reminder materialization.
Never treat a cron success or a queued HTTP request as proof of SMS delivery.

```sql
select * from private.meeting_scheduler_state;
select jobname,schedule,active from cron.job;
select status,count(*) from private.meeting_notification_jobs group by status;
```

## Schema baseline and future transfers

The removed historical migration bodies cannot be recovered from Git's current
migration directory. A schema baseline must be captured from the actual source
database, including its managed runtime and grants. On that database host, use a
matching `pg_dump`/`psql` version and normal libpq settings (or a service/password file):

```sh
python scripts/export-database-baseline.py /secure-backups/spark-schema-baseline
```

This produces full schema SQL, version/name migration history and checksums. It
does not export business rows, secret values, role passwords or historical migration
statement bodies. Keep the export private: schema/function code may itself contain
deployment details. It does not replace a full data backup or secure Vault/root-key
transfer. Restore into the matching Supabase/Postgres runtime with required roles
and extensions present, preserve ACLs, then apply pending migrations and run tests.
The exporter was tested with mocked tools; a fresh-runtime restore has not been
performed by this repair task, so clean-install reproducibility is not claimed.

## Validation after deployment or restore

Run with `psql -X -v ON_ERROR_STOP=1 -f <file>`:

- `tests/database/internalRpcExecution.sql`
- `tests/database/diagnosticAndCalendarSecurity.sql`
- `tests/database/remainingAuditRepairs.sql`
- `tests/database/meetingSchedulerReadiness.sql`
- `tests/database/recurringMeetingSeriesSafety.sql`
- `tests/database/recurringMeetingNotifications.sql`

Every test rolls back its fixtures. The scheduler-readiness test stubs secret
lookup only inside its rolled-back transaction, so it sends no external
request. Never fabricate production credentials to make a readiness check pass.
