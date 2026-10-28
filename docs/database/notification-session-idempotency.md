# Notification session and event-key conflict repair

Migration: `20261028052323_harden_notification_session_and_event_key_conflicts.sql`.

## Root causes and minimal fix

The user-facing public create_notification RPC delegates to an owner-executed private
implementation. It checked auth.uid() and organization/recipient eligibility but omitted
FULL session authorization. A revoked fixture session could insert notifications.
The implementation now checks private.is_current_session_fully_authorized() before
profile reads, template rendering, inserts or duplicate-key handling.

Notifications share a global, partial unique index on event_key with trusted producers.
Previously ON CONFLICT performed a no-op update and returned the existing row's UUID
for any matching key, regardless of recipient or sender. A key belonging to an unrelated
organization returned created:false and the other notification ID; no notification was
created for the intended recipient, and the frontend treated that result as a duplicate.

The same INSERT ... ON CONFLICT statement now matches both existing.user_id and
existing.sender_id against the proposed row. A matching sender/recipient retry retains
the existing created:false/notification_id contract. A different sender or recipient
(including a server-origin row with NULL sender) raises NOTIFICATION_EVENT_KEY_CONFLICT,
SQLSTATE 23505. It returns no other row's UUID and does not change that row. The existing
frontend repository already treats RPC errors as failure, not a successful duplicate.
Callers must use a distinct event key for a distinct notification.

Conflict matching occurs in the unique-index-controlled statement, rather than a separate
pre-check. The global index, existing keys/rows, public signature/result shape, grants,
trusted producers and frontend code are unchanged. NULL event keys still allow ordinary
non-deduplicated inserts. Same-owner retry payloads remain unchanged as before.
No multi-connection concurrency test was run; the SQL test covers ownership/conflict
semantics, and the implementation retains PostgreSQL's atomic ON CONFLICT operation.

Only the private notification implementation is changed in a new migration. Apply this
migration with the normal runner after restoring/moving the database; no manual repair
or previous migration edits are required.

## Database validation

Executed tests/database/notificationSessionAndIdempotency.sql on the connected
non-production project with plpgsql.check_asserts enabled. All fixtures, notifications,
inbox entries, meetings and settings changes roll back.

- Healthy sender: insert succeeds, same sender/recipient retry returns the same ID with
  created:false, original payload is retained and only one keyed row remains.
- Different recipient, different sender, cross-organization existing key, and NULL
  system sender conflicts raise the explicit conflict error; protected rows are unchanged.
- NULL-key calls insert independent rows.
- Existing direct cross-organization recipient denial is retained.
- Revocation, temporary lock, suspension, idle expiry, absolute expiry, epoch mismatch,
  and MFA restriction deny new writes, otherwise valid retries and ownership conflicts.
- Anonymous access is rejected.
- Actual authenticated invitation-delegation RPC calls still insert their template
  notification. The owner-delegation function's definer chain is tested as the migration
  owner with a FULL fixture JWT; both template notifications are asserted in the database.

### Independent existing limitation discovered during validation

public.assign_meeting_owner_delegate(uuid,uuid) is SECURITY INVOKER and callable by
authenticated, but private.assign_meeting_owner_delegate(uuid,uuid) grants EXECUTE only
to postgres. An actual authenticated browser-wrapper call therefore fails with 42501
before its body. Inspection confirmed this ACL was already present before this repair.
The invitation-delegation helper does grant authenticated EXECUTE and its browser route
passed. The owner-delegation ACL is outside these two notification fixes and was left
unchanged; the test explicitly labels its owner-only chain verification.

To execute the suite as the migration owner on a migrated non-production database:

```sh
psql -X -v ON_ERROR_STOP=1 -f tests/database/notificationSessionAndIdempotency.sql
```

The existing notification-action, recurring-meeting-notification and role/phone/sharing
SQL suites also passed. All 17 notification producer/model tests and the production
build passed. No lint or PR was run/created. Final catalog checks confirmed the global
index definition is unchanged and no notification-security fixture rows remain.
