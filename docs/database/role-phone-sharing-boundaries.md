# Role, phone flags and sharing boundary repair

Migration: `20261028051030_repair_role_phone_flags_and_sharing_boundaries.sql`.

## Root causes and minimal changes

The legacy `private.set_user_security_admin` implementation checked admin flags,
Auth session existence/expiry and a step-up grant, but omitted the canonical FULL
session gate. A revoked administrator with an unconsumed step-up could remove another
fixture user's security-admin role. The implementation now checks
`private.is_current_session_fully_authorized()` before protected work. Existing role,
target, last-admin, TOTP, step-up, optimistic version, history and audit rules remain.
The newer `set_user_role_level` route is unchanged.

`private.set_phone_auth_canonical_flags`, used by PhoneAuthCard, referenced
`session_security_grants.revoked_at`; that column does not exist. A healthy security
administrator received SQLSTATE 42703. The incorrect predicate is removed. The
existing session validation, purpose/factor/assurance checks, consumed_at/expiry
checks and grant consumption remain. A canonical FULL session check was added so
revoked, locked, expired or restricted sessions cannot change flags after this
runtime error is repaired. No new database column is required.

The owner-executed `private.share_note_to_user` and `private.share_contact_to_user`
only checked auth.uid(), allowing cross-organization inserts and writes from revoked
sessions. Both now require FULL access and a recipient profile that is ACTIVE,
is_active, not hidden, and in the caller's same nonempty organization. This matches
the organization boundary of the UI recipient directory. Public RPC signatures and
void results remain. The existing contact self-share prohibition remains; the note
sender argument and note self-sharing behavior are unchanged. Table references now
use explicit public qualification with an empty search path.

These are function-only changes in a new migration. Previous migrations, tables,
columns, grants, frontend code, secrets and worker configuration are unchanged.
Apply the committed migration using the normal runner after restoring/moving the
database; no manual function edits need to be reconstructed.

## Real database validation

`tests/database/rolePhoneSharingBoundaries.sql` executed successfully on the connected
non-production database with plpgsql.check_asserts enabled. It calls the public RPCs
as actual authenticated/anonymous roles. All fixture rows, role changes, flags,
grants, audit/history rows and temporary helpers roll back.

- Seven blocked states (revocation, temporary lock, suspension, idle expiry,
  absolute expiry, auth-epoch mismatch, MFA enrollment restriction) deny all four
  paths without consuming step-up, changing roles/versions/flags or inserting data.
- A valid security administrator can use the legacy role RPC; persisted role,
  version increment and role-history record are asserted.
- A valid settings step-up updates both canonical phone flags without the missing
  column error. Both persisted values and the audit event are checked.
- Wrong-purpose/missing and already-consumed step-up grants still fail.
- A regular FULL user cannot change security roles or phone-auth flags.
- Sharing within the organization succeeds and actual note/contact rows are checked.
  Cross-organization, suspended, hidden, missing and organization-less cases fail.
  Contact self-sharing and anonymous access remain rejected.

To run as the migration owner on a migrated non-production database with psql/libpq:

```sh
psql -X -v ON_ERROR_STOP=1 -f tests/database/rolePhoneSharingBoundaries.sql
```

The three existing database suites for admin/avatar/informee access, minutes/session
behavior, and audit/relationships/dates also passed after the migration. The production
build passed. No lint or PR was run/created. Final catalog checks confirmed all four
implementations use the canonical gate, the invalid column reference is gone, and
no fixture profiles, notes or contacts remain.
