# Session and helper authorization repair

Migration: `20261028041641_align_session_and_helper_authorization.sql`.

The shared RLS gate called the older auth evaluator, which omitted temporary account locks.
It now delegates to `private.get_my_auth_access_state_v3()`, the same canonical evaluator
used by the audit API. Its owner-executed dependencies do not call the shared gate.

The security-definer decision synchronizer checked document ownership/status but omitted
FULL session authorization. It now checks FULL access before any mutation. The private
create/update RPC implementations and the four-argument public invoker update also check
FULL access, including calls without decisions. Existing ownership and version checks remain.
Authenticated EXECUTE on the guarded synchronizer is intentional: the four-argument invoker
update calls it. Anonymous and PUBLIC EXECUTE are revoked; the legacy helper stays server-only.

The conversation lookup previously returned a conversation UUID for any known message UUID,
including to anonymous callers. It now requires FULL access and participation via the existing
direct/group/channel participant helper, uses an empty search path, and denies anonymous EXECUTE.
This changes no message content or membership rules.

All changes are in a new migration. Apply it with the repository migration runner after restoring
or moving the database; do not replay manual function edits or edit old migrations. Configuration,
keys and Edge Function deployment remain separate migration prerequisites documented elsewhere.

## Validation

- Executed `tests/database/minutesFollowupRuntime.sql` on the connected non-production project.
  All assertions passed with `plpgsql.check_asserts=on`; fixtures/settings rolled back.
- Exercised actual authenticated/anonymous roles: create with an external decision, both update
  overloads, guarded helper, valid weekly recurrence and rejection of invalid recurrence.
- Verified persisted decision fields as the owner (draft decisions have intentionally narrower
  tracking SELECT rules), outsider mutation denial, direct/group creator/group member lookups,
  nonmember/anonymous denial, and restoration of a healthy session.
- Seven blocked states tested against actual RPCs and message RLS: temporary lock, suspended
  account, revoked session, idle expiry, absolute expiry, auth-epoch mismatch, absent session state.
- Replaced 17 unconditional passing TypeScript cases with an actual psql integration runner.
  Without explicit opt-in it reports SKIP, not a database pass. To run against a migrated test
  database as its migration owner, with psql installed:

  ```sh
  SPARK_DATABASE_TESTS=1 PGDATABASE=spark_test npm run test:minutes-followup-runtime
  ```

  Other libpq variables or `PGSERVICE` may select the target. No secrets are printed by the runner.
- Existing saved-message history, audit/relationship/counter/date, and diagnostic/calendar SQL regression suites also passed.
- Production build passed; 25 decision conversion/reminder tests passed.
- Existing `test:minutes-create-submit`: 38 passed, one failed at
  `minutesCreateSubmitFlow.test.ts:833` because it expects the exact source text
  `saveCurrentValues: boolean;` while the source uses an inline object type without that
  semicolon. Neither this test nor its source file differs from the starting main commit.
  Left unchanged to respect scope.
- No lint or PR.
