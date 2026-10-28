# Admin session, avatar queue and informee RPC repair

Migration: `20261028045535_harden_admin_session_avatar_and_informee_rpcs.sql`.

## Root cause and scope

Several owner-executed RPCs checked identity/admin flags or the existence of an
Auth session, but not its revocation, expiry, temporary account lock or MFA restriction.
The shared RLS gate cannot protect queries executed by a security-definer owner.
Before repair, rolled-back tests reproduced a revoked security administrator reading
locked accounts, disabling password recovery and unlocking another fixture account
with a still-unconsumed step-up grant.

The new migration adds `private.is_current_session_fully_authorized()` to these
implementations before accessing protected data or consuming grants:

- `private.list_locked_accounts()`
- `private.list_malformed_phone_records()`
- `private.security_admin_unlock_account(uuid)`
- `private.clear_malformed_phone_record(uuid)`
- `private.set_auth_security_settings_patch(integer,jsonb,text)`
- `public.set_phone_password_recovery_config(boolean)`
- `public.set_phone_password_recovery_test_mode(boolean,text)`

Existing identity, role, eligibility, version and step-up checks remain. Table/JSON
return shapes remain. Blocked requests raise or return `SESSION_NOT_FULLY_AUTHORIZED`;
the existing public settings wrapper can reject inactive/suspended administrators
earlier with `SECURITY_ADMIN_REQUIRED`.

`public.get_my_informee_meetings_v1()` now requires FULL session access in addition to
its existing `notify_users` membership filter. Before repair it returned fixture meeting
details to a revoked session.

`public.create_avatar_job(uuid,text)` previously allowed anonymous callers to enqueue
jobs for another profile. EXECUTE is now revoked from PUBLIC, anon and authenticated,
and explicitly retained for service_role. The existing `avatar-upload` Edge Function
uploads the validated file and invokes this RPC through its admin client; its code
requires no change. Anonymous job creation was reproduced; an actual avatar overwrite
was not demonstrated.

No tables, previous migrations, cron schedules, secrets or Edge deployments changed.
Apply this new migration with the normal migration runner after a database move;
these changes require no manual reconstruction.

## Validation

Executed `tests/database/adminSessionAvatarInformeeSecurity.sql` through the connected
non-production Supabase database with `plpgsql.check_asserts=on`. All fixtures, settings,
step-up grants, jobs and document changes rolled back.

- Actual anon/authenticated roles cannot enqueue avatar jobs; service_role can.
- Seven states reject protected admin RPCs and informee reads: revoked session,
  temporary lock, suspended account, idle expiry, absolute expiry, epoch mismatch,
  and MFA enrollment restriction.
- Rejected requests do not consume step-up grants, delete the orphan Auth fixture,
  unlock the target, change recovery settings or increment settings version.
- Healthy security administrators can list locked/orphan accounts, perform a
  step-up unlock and orphan cleanup, disable recovery/test mode, and patch settings
  with a fresh step-up grant. Actual mutation effects and settings version are checked.
- Missing fresh step-up still returns STEPUP_REQUIRED.
- An ordinary FULL user cannot perform administrator operations or read a meeting
  where they are not an informee; the authorized informee can read it.

Run the suite as the migration owner against a migrated test database, using psql
with libpq connection configuration:

```sh
psql -X -v ON_ERROR_STOP=1 -f tests/database/adminSessionAvatarInformeeSecurity.sql
```

The existing minutes/session, audit/relationship/date, and diagnostic/calendar SQL
regression suites also passed. The production build and 25 decision/reminder tests
passed. No lint or PR was run/created.
